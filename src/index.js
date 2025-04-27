import Parser from "rss-parser";
import crypto from "crypto";
import OAuth from "oauth-1.0a";
import { URL, URLSearchParams } from "url";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TOKEN_FILE_PATH = path.join(__dirname, "..", ".data", "token_store.json");

const consumer_key = process.env.TWITTER_API_KEY;
const consumer_secret = process.env.TWITTER_KEY_SECRET;

const parser = new Parser();

const feeds = [
  "https://micronews.debian.org/feeds/feed.rss",
  "https://bits.debian.org/feeds/feed.rss",
];

let feedHashes = {};

if (!consumer_key || !consumer_secret) {
  console.error(
    "Error: Missing TWITTER_API_KEY and TWITTER_KEY_SECRET environment variables."
  );
  process.exit(1);
}

const REQUEST_TOKEN_URL = "https://api.twitter.com/oauth/request_token";
const AUTHORIZE_URL = "https://api.twitter.com/oauth/authorize";
const ACCESS_TOKEN_URL = "https://api.twitter.com/oauth/access_token";
const POST_TWEET_URL = "https://api.twitter.com/2/tweets";

const oauth = OAuth({
  consumer: { key: consumer_key, secret: consumer_secret },
  signature_method: "HMAC-SHA1",
  hash_function(baseString, key) {
    return crypto.createHmac("sha1", key).update(baseString).digest("base64");
  },
});

function parseQueryString(text) {
  return Object.fromEntries(new URLSearchParams(text));
}

async function makeRequest(url, options, responseType = "json") {
  const response = await fetch(url, options);

  return responseType === "text"
    ? await response.text()
    : await response.json();
}

async function getRequestToken() {
  const requestData = {
    url: REQUEST_TOKEN_URL,
    method: "POST",
    data: { oauth_callback: "oob", x_auth_access_type: "write" },
  };
  const headers = oauth.toHeader(oauth.authorize(requestData));
  const responseText = await makeRequest(
    `${REQUEST_TOKEN_URL}?oauth_callback=oob&x_auth_access_type=write`,
    { method: "POST", headers: headers },
    "text"
  );
  const parsed = parseQueryString(responseText);
  if (!parsed.oauth_token || !parsed.oauth_token_secret) {
    throw new Error(`Failed to parse request token response: ${responseText}`);
  }
  return parsed;
}

async function getAccessToken(requestToken, verifier) {
  const requestData = { url: ACCESS_TOKEN_URL, method: "POST" };
  const headers = oauth.toHeader(
    oauth.authorize(requestData, {
      key: requestToken.oauth_token,
      secret: requestToken.oauth_token_secret,
    })
  );
  const urlWithParams = `${ACCESS_TOKEN_URL}?oauth_verifier=${encodeURIComponent(
    verifier
  )}&oauth_token=${encodeURIComponent(requestToken.oauth_token)}`;
  const responseText = await makeRequest(
    urlWithParams,
    { method: "POST", headers: headers },
    "text"
  );
  const parsed = parseQueryString(responseText);
  if (!parsed.oauth_token || !parsed.oauth_token_secret) {
    throw new Error(`Failed to parse access token response: ${responseText}`);
  }
  return parsed;
}

async function postTweet(accessToken, tweetPayload) {
  const token = {
    key: accessToken.oauth_token,
    secret: accessToken.oauth_token_secret,
  };
  const requestData = { url: POST_TWEET_URL, method: "POST" };
  const headers = oauth.toHeader(oauth.authorize(requestData, token));
  headers["User-Agent"] = "ModernNodeTwitterClient/1.1";
  headers["Content-Type"] = "application/json";
  headers["Accept"] = "application/json";

  return await makeRequest(
    POST_TWEET_URL,
    { method: "POST", headers: headers, body: JSON.stringify(tweetPayload) },
    "json"
  );
}

async function loadStoredToken() {
  try {
    const data = await fs.readFile(TOKEN_FILE_PATH, "utf8");
    const token = JSON.parse(data);
    if (token && token.oauth_token && token.oauth_token_secret) {
      console.log("Loaded access token from file.");
      return token;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Warning: Could not read token file: ${error.message}`);
    }
  }
  return null;
}

async function saveStoredToken(token) {
  try {
    await fs.writeFile(TOKEN_FILE_PATH, JSON.stringify(token, null, 2), "utf8");
    console.log("Access token saved to", TOKEN_FILE_PATH);
  } catch (error) {
    console.error(`Error saving token file: ${error.message}`);
  }
}

async function main() {
  let accessToken = await loadStoredToken();

  if (!accessToken) {
    const oAuthRequestToken = await getRequestToken();

    const authorizeUrl = new URL(AUTHORIZE_URL);
    authorizeUrl.searchParams.set("oauth_token", oAuthRequestToken.oauth_token);

    console.log("Not logged in. Please visit the following URL to authorize:");
    console.log(authorizeUrl.href);
    const pin = prompt("   Output PIN:");

    accessToken = await getAccessToken(oAuthRequestToken, pin.trim());
    await saveStoredToken(accessToken);
  }

  console.log("Logged in as:", accessToken.screen_name);

  setInterval(async () => {
    feeds.forEach(async (feedUrl) => {
      let feed = await parser.parseURL(feedUrl);

      const hashedPosts = feed.items.map((item) => {
        return Bun.hash(JSON.stringify(item));
      });
      const oldHashedPosts = feedHashes[feedUrl] || [];

      const newPosts = feed.items.filter((_, i) => {
        const hash = hashedPosts[i];
        return !oldHashedPosts.includes(hash);
      });

      if (!feedHashes[feedUrl] || feedHashes[feedUrl]?.length === 0) {
        console.log("Saving post hashes for the first time");
        feedHashes[feedUrl] = hashedPosts;
        return;
      }

      newPosts.forEach(async (item) => {
        const { title, link, categories } = item;

        const text = `${title.slice(0, 150)} ${(categories || [])
          .map((c) => `#${c}`)
          .join(" ")}\n${link}`;

        const post = await postTweet(accessToken, {
          text: text.slice(0, 280),
        });

        console.log(
          `New post: https://twitter.com/${accessToken.screen_name}/status/${post.data.id}`
        );
      });
    });
  }, 15 * 60 * 1000);
}

main();
