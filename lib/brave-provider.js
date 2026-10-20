import{pause,abortable}from'./run-context.js';
import https from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";

export function braveProvider({
  key = process.env.BRAVE_SEARCH_API_KEY,
  request = jsonRequest,
  minInterval = 1100,
  beforeRequest=async()=>{},
} = {}) {
  // Google Play enrichment and discovery share one queue and the same API key.
  let pending = Promise.resolve(), nextRequestAt = 0;
  const queuedRequest = (url, headers,signal) => {
    const operation = pending.then(async () => {
      signal?.throwIfAborted();
      const waitMs = Math.max(0, nextRequestAt - Date.now());
      if (waitMs) await pause(waitMs,signal);
      signal?.throwIfAborted();
      await beforeRequest({signal});signal?.throwIfAborted();
      nextRequestAt = Date.now() + minInterval;
      return abortable(()=>request(url, headers,{signal}),signal);
    });
    pending = operation.catch(() => {});
    return operation;
  };
  return {
    configured: () => Boolean(key),
    setBeforeRequest(callback){beforeRequest=callback;},
    async search({ q, count, freshness, search_lang },{signal}={}) {
      if (!key)
        throw Object.assign(new Error("Search key is missing"), {
          code: "MISSING_KEY",
        });
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      for (const [name, value] of Object.entries({
        q,
        count,
        freshness,
        search_lang,
        country: "ALL",
        text_decorations: false,
        extra_snippets: true,
        spellcheck: false,
        result_filter: "web",
      }))
        if (value !== undefined && value !== null) url.searchParams.set(name, String(value));
      const data = await queuedRequest(url, {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },signal);
      if (
        data?.error ||
        !data ||
        typeof data !== "object" ||
        (!data.web && !data.query && data.type !== "search")
      )
        throw Object.assign(new Error("Invalid source response"), {
          code: "INVALID_RESPONSE",
        });
      if (data.web && !Array.isArray(data.web.results))
        throw Object.assign(new Error("Invalid source results"), {
          code: "INVALID_RESPONSE",
        });
      return data.web?.results ?? [];
    },
  };
}

function jsonRequest(url, headers,{signal}={}) {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const agent = proxy ? new HttpsProxyAgent(proxy) : undefined;
  return new Promise((resolve, reject) => {
    let ended = false;
    const fail = (error) => {
      if (!ended) {
        ended = true;
        clearTimeout(timer);
        agent?.destroy();
        reject(error);
      }
    };
    const req = https.get(url, { headers, agent,signal }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        fail(
          Object.assign(new Error("Search API request failed"), {
            status: res.statusCode,
          }),
        );
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) {
          req.destroy();
          fail(new Error("Response too large"));
        } else chunks.push(chunk);
      });
      res.on("error", fail);
      res.on("end", () => {
        if (ended) return;
        ended = true;
        clearTimeout(timer);
        agent?.destroy();
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new Error("Invalid source JSON"));
        }
      });
    });
    const timer = setTimeout(() => {
      fail(
        Object.assign(new Error("Search API timed out"), {
          code: "API_TIMEOUT",
        }),
      );
      req.destroy();
    }, 25000);
    req.on("error", fail);
  });
}
