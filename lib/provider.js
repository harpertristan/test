import gplay from 'google-play-scraper';
import { HttpsProxyAgent } from 'https-proxy-agent';

export function liveProvider() {
  const proxy = process.env.HTTPS_PROXY || process.env.https_proxy;
  const requestOptions = {
    timeout: { request: 25000 }, retry: { limit: 0 },
    ...(proxy ? { agent: { https: new HttpsProxyAgent(proxy) } } : {})
  };
  return {
    search: options => gplay.search({ ...options, requestOptions, throttle: 2 }),
    app: options => gplay.app({ ...options, requestOptions, throttle: 2 })
  };
}
