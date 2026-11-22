/**
 * Isolated Cookie-Jar HTTP Client for Node.js 22+
 * Utilizes native fetch and Headers.prototype.getSetCookie()
 */
export class TestHttpClient {
  /**
   * @param {string} baseUrl - Base URL for the client (e.g. http://127.0.0.1:43210)
   */
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.cookieJar = new Map();
  }

  /**
   * Set a cookie directly into the jar
   * @param {string} name
   * @param {string} value
   */
  setCookie(name, value) {
    this.cookieJar.set(name, value);
  }

  /**
   * Get cookie value by name
   * @param {string} name
   * @returns {string|undefined}
   */
  getCookie(name) {
    return this.cookieJar.get(name);
  }

  /**
   * Clear all stored cookies
   */
  clearCookies() {
    this.cookieJar.clear();
  }

  /**
   * Returns all cookies as an object { name: value }
   */
  getAllCookies() {
    return Object.fromEntries(this.cookieJar.entries());
  }

  /**
   * Parse Set-Cookie header array and update internal cookie jar
   * @param {Response} response
   */
  _updateCookies(response) {
    if (!response.headers) return;

    let setCookieHeaders = [];
    if (typeof response.headers.getSetCookie === 'function') {
      setCookieHeaders = response.headers.getSetCookie();
    } else {
      const single = response.headers.get('set-cookie');
      if (single) setCookieHeaders = [single];
    }

    for (const cookieStr of setCookieHeaders) {
      if (!cookieStr) continue;
      const parts = cookieStr.split(';').map((s) => s.trim());
      const [nameVal, ...attrs] = parts;
      const eqIdx = nameVal.indexOf('=');
      if (eqIdx === -1) continue;

      const name = nameVal.slice(0, eqIdx).trim();
      const value = nameVal.slice(eqIdx + 1).trim();

      // Check for Max-Age=0 or expired
      let isExpired = false;
      for (const attr of attrs) {
        const lower = attr.toLowerCase();
        if (lower === 'max-age=0' || lower.startsWith('max-age=-')) {
          isExpired = true;
          break;
        }
        if (lower.startsWith('expires=')) {
          const expDate = new Date(attr.slice(8).trim());
          if (expDate.getTime() <= Date.now()) {
            isExpired = true;
            break;
          }
        }
      }

      if (isExpired || !value) {
        this.cookieJar.delete(name);
      } else {
        this.cookieJar.set(name, value);
      }
    }
  }

  /**
   * Construct Cookie header string from jar
   * @returns {string}
   */
  _buildCookieHeader() {
    if (this.cookieJar.size === 0) return '';
    return Array.from(this.cookieJar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  /**
   * Internal request wrapper around native fetch
   */
  async request(pathOrUrl, options = {}) {
    const url = pathOrUrl.startsWith('http')
      ? pathOrUrl
      : `${this.baseUrl}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;

    const headers = new Headers(options.headers || {});

    // Attach cookies if not explicitly provided
    if (!headers.has('cookie')) {
      const cookieHeader = this._buildCookieHeader();
      if (cookieHeader) {
        headers.set('cookie', cookieHeader);
      }
    }

    const fetchOptions = {
      redirect: 'manual', // Manual redirects so tests can assert 302 and Location
      ...options,
      headers,
    };

    const response = await fetch(url, fetchOptions);
    this._updateCookies(response);

    // If response is a 301 trailing-slash canonicalization redirect, follow it automatically
    if (response.status === 301) {
      const loc = response.headers.get('location');
      if (loc) {
        const currentParsed = new URL(url);
        const nextParsed = new URL(loc, url);
        if (
          nextParsed.origin === currentParsed.origin &&
          nextParsed.pathname === currentParsed.pathname + '/'
        ) {
          return this.request(nextParsed.toString(), options);
        }
      }
    }

    return response;
  }

  async get(path, headers = {}) {
    return this.request(path, { method: 'GET', headers });
  }

  async post(path, body = null, headers = {}) {
    return this.request(path, { method: 'POST', body, headers });
  }

  async put(path, body = null, headers = {}) {
    return this.request(path, { method: 'PUT', body, headers });
  }

  async delete(path, body = null, headers = {}) {
    return this.request(path, { method: 'DELETE', body, headers });
  }

  async postJson(path, jsonBody, headers = {}) {
    const finalHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    return this.request(path, {
      method: 'POST',
      body: JSON.stringify(jsonBody),
      headers: finalHeaders,
    });
  }

  async putJson(path, jsonBody, headers = {}) {
    const finalHeaders = {
      'Content-Type': 'application/json',
      ...headers,
    };
    return this.request(path, {
      method: 'PUT',
      body: JSON.stringify(jsonBody),
      headers: finalHeaders,
    });
  }

  async getJson(path, headers = {}) {
    const res = await this.get(path, headers);
    const data = await res.json();
    return { status: res.status, data, headers: res.headers, raw: res };
  }
}
