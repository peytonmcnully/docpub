const Promise = require('bluebird');
const Queue = require('promise-queue');

const fs = require('fs');
const request = require('request');

const constants = require('./constants');
const logger = require('../logger');

Queue.configure(Promise);

/**
 * Wrapper class for the `node-zendesk` api client
 * Wraps all requests in the `articles`, `sections`, `categories`, and `accesspolcies` objects in Promises
 * Also wraps requests with a retry functionality that will retry the request if the error response is >= 500 or contains a `retryAfter` property
 * Subsequent retries without a "retry-after" header will wait twice as long as the last retry before trying the request again
 * Also contains a request queue to limit the number of concurrent connections
 */

const MAX_RETRIES = 6;
const RETRY_AFTER_DEFAULT = 500;
const RETRY_AFTER_MAX = 8000;
const MAX_CONCURRENT = 29;

module.exports = class ZendeskClientWrapper {
    /**
     * Creates a wrapper around the provided node-zendesk api client
     * @param {object} client - the node-zendesk client to wrap (object returned by zendesk::createClient() )
     */
    constructor(client) {
        if (!client) {
            throw new Error('No ZenDesk client to wrap provided!');
        }

        this._client = client;
        this._queue = new Queue(MAX_CONCURRENT);
        const endpoints = [
            'articles',
            'articleattachments',
            'sections',
            'accesspolicies',
            'categories',
            'translations'
        ];

        endpoints.forEach(endpoint => {
            this._wrapPrototypeMethods(endpoint);
        });

        // This method must be created manually because the API client doesn't have it
        this.articleattachments.create = (articleId, resourcePath) => {
            return this._createPromiseRequest(this, this._createAttachment, articleId, resourcePath);
        };
    }

    _wrapPrototypeMethods(property) {
        if (!this._client.hasOwnProperty(property)) {
            return;
        }
        const prototype = Object.getPrototypeOf(this._client[property]);
        this[property] = {};
        for (const method in prototype) {
            if (typeof prototype[method] === 'function') {
                this._createMethod(this[property], this._client[property], method);
            }
        }
    }

    _createMethod(property, client, method) {
        property[method] = (...args) => {
            args = [client[method]].concat(args);
            // Passes the method's parent object as `this` value - for example `client.articles`
            args = [client].concat(args);
            return this._createPromiseRequest(...args);
        };
    }

    _createPromiseRequest(...args) {
        let retries = MAX_RETRIES;
        // First param is `this` value - second is the method to call - subsequent params will be passed to the method
        const client = args.shift();
        const method = args.shift();

        const promise = () => new Promise((resolve, reject) => {
            args.push((err, statusCode, result) => {
                if (!err) {
                    return resolve(result);
                } else if ((err.retryAfter || err.statusCode >= 500) && retries > 0) {
                    // err.retryAfter is present on all 429 (rate limit has been exceeded) and some 503 errors
                    // err.retryAfter is time to wait in seconds
                    const retryAfter = err.retryAfter
                        ? err.retryAfter * 1000
                        : this._calcRetryAfter(MAX_RETRIES - retries);
                    retries--;
                    setTimeout(() => method.apply(client, args), retryAfter);

                    logger.warn(`Zendesk request failed. Retrying request after ${retryAfter} milliseconds. ${retries} attempts are remaining.`);
                } else {
                    return reject(err);
                }
            });
            method.apply(client, args);
        });

        return this._queue.add(promise);
    }

    _calcRetryAfter(retryNumber) {
        // Default retry should wait twice as long as the previous retry
        const multiplier = Math.max(Math.pow(2, retryNumber), 1);

        return Math.min(
            RETRY_AFTER_DEFAULT * multiplier,
            RETRY_AFTER_MAX
        );
    }

    _createAttachment(articleId, resourcePath, callback) {
        const endpoint = `/articles/${articleId}/attachments.json`;
        const params = this._buildAuthRequest(endpoint);
        params.formData = {
            // The request module will throw errors if you try to send this as a boolean instead of a string
            inline: 'true',
            file: fs.createReadStream(resourcePath)
        };

        request.post(params, (error, response, result) => {
            result = result ? JSON.parse(result)[constants.ARTICLE.ATTACHMENT] : null;
            error = this._buildError(error, response);
            callback(error, response, result);
        });
    }

    _buildAuthRequest(endpoint) {
        const params = {};
        const url = this._client.articles.options.get('remoteUri');
        const user = this._client.articles.options.get('username');
        const password = this._client.articles.options.get('password');
        const token = this._client.articles.options.get('token');
        const useOAuth = this._client.articles.options.get('oauth');

        params.url = url + endpoint;

        params.auth = {};
        if (useOAuth) {
            // Set bearer token if using OAuth
            params.auth.bearer = token;
        } else if (password) {
            // Use password auth if password is set
            params.auth.user = user;
            params.auth.pass = password;
        } else {
            // Use API token as default
            params.auth.user = `${user}/token`;
            params.auth.pass = token;
        }

        return params;
    }

    _buildError(error, response) {
        if (!error && response.statusCode >= 400) {
            error = {};
            error.statusCode = response.statusCode;
        }
        if (response.headers && response.headers['retry-after']) {
            error = error || {};
            error.retryAfter = response.headers['retry-after'];
        }
        return error;
    }
};
