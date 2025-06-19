import Parser from "rss-parser";
import { promises as fs } from "fs";
import composeTweet from "./composer.js";
import path from "path";

const parser = new Parser();
const CACHE_FILE = path.join(process.cwd(), "cache.json");
const RELOAD_DELAY = 5 * 60 * 1000; // 5 minutes

const feeds = [
  "https://micronews.debian.org/feeds/feed.rss",
  "https://bits.debian.org/feeds/feed.rss",
];

let feedCaches = {};

async function saveCache() {
  try {
    await fs.writeFile(CACHE_FILE, JSON.stringify(feedCaches, null, 2));
    console.log("Cache saved to file");
  } catch (error) {
    console.error("Error saving cache:", error.message);
  }
}

(async () => {
  try {
    const data = await fs.readFile(CACHE_FILE, "utf8");
    feedCaches = JSON.parse(data);
  } catch (error) {
    console.log("No existing cache found, starting fresh");
    feedCaches = {};
  }

  const res = await fetch("https://pro.x.com/", {
    headers: {
      accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
      "cache-control": "no-cache",
      pragma: "no-cache",
      cookie: `auth_token=${process.env.TWITTER_AUTH_TOKEN};`,
    },
  });

  const csrfToken = res.headers
    .get("set-cookie")
    .split(", ct0=")[1]
    .split(";")[0];
  const cookies = `auth_token=${process.env.TWITTER_AUTH_TOKEN}; ct0=${csrfToken};`;

  console.log("Logged in");

  const processFeeds = async () => {
    for (const feedUrl of feeds) {
      try {
        const feed = await parser.parseURL(feedUrl);

        const postLinks = feed.items.map((item) => item.link);
        const oldPostLinks = feedCaches[feedUrl] || [];

        const newPosts = feed.items.filter(
          (item) => !oldPostLinks.includes(item.link)
        );

        if (!feedCaches[feedUrl] || feedCaches[feedUrl].length === 0) {
          feedCaches[feedUrl] = postLinks;
          await saveCache();
          continue;
        }

        if (newPosts.length > 0) {
          for (const item of newPosts) {
            const { title, link, categories = [] } = item;
            const hashtags = categories.map((c) => `#${c}`).join(" ");
            const text = `${title.slice(0, 150)} ${hashtags}\n${link}`.slice(
              0,
              280
            );

            console.log(`New post: ${text.slice(0, 280)}`);

            composeTweet({ text, cookies, csrfToken });
          }

          feedCaches[feedUrl] = postLinks;
          await saveCache();
        }
      } catch (error) {
        console.error(`Error processing feed ${feedUrl}:`, error.message);
      }
    }
  };

  await processFeeds();
  setInterval(processFeeds, RELOAD_DELAY);
})().catch(console.error);
