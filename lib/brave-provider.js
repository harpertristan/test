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
    async search({ q, count=20, freshness, search_lang, allPages=false, onPage=()=>{} },{signal}={}) {
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
      const results=[],seen=new Set();
      // Brave documents offsets 0..9; this is the service's pagination range.
      for(let offset=0;offset<(allPages?10:1);offset++){
      url.searchParams.set('offset',String(offset));onPage(offset);
      let data;try{data = await queuedRequest(new URL(url), {
        Accept: "application/json",
        "X-Subscription-Token": key,
      },signal);}catch(error){if(signal?.aborted||!results.length||[401,403,429].includes(error.status))throw error;results.partialError=true;return results;}
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
      const page=data.web?.results??[];let added=0;for(const row of page){if(seen.has(row.url))continue;seen.add(row.url);results.push(row);added++;}
      if(!page.length||!added||data.query?.more_results_available===false)break;
      }
      return results;
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
