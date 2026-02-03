# Rate Limiting

AgentPlanner API implements rate limiting to protect against abuse and ensure fair usage.

## Default Limits

| Endpoint Type | Requests | Window | Description |
|--------------|----------|--------|-------------|
| General | 100 | 1 minute | Standard API endpoints |
| Auth | 10 | 1 minute | Login, register, password reset |
| Search | 30 | 1 minute | Search operations |
| Token | 5 | 1 minute | API token generation |
| Webhook | 20 | 1 minute | Webhook management |

## Response Headers

All responses include standard rate limit headers:

```
RateLimit-Limit: 100
RateLimit-Remaining: 95
RateLimit-Reset: 1609459200
```

## Rate Limit Exceeded (429)

When a rate limit is exceeded, the API returns:

```json
{
  "error": "Too many requests",
  "message": "You have exceeded the rate limit. Please try again later.",
  "type": "general",
  "retryAfter": 45
}
```

The `Retry-After` header indicates seconds until the limit resets.

## Configuration

Rate limits can be configured via environment variables:

```bash
# General API limit (default: 100 req/min)
RATE_LIMIT_GENERAL=100
RATE_LIMIT_GENERAL_WINDOW_MS=60000

# Auth endpoints (default: 10 req/min)
RATE_LIMIT_AUTH=10
RATE_LIMIT_AUTH_WINDOW_MS=60000

# Search endpoints (default: 30 req/min)
RATE_LIMIT_SEARCH=30
RATE_LIMIT_SEARCH_WINDOW_MS=60000

# Token generation (default: 5 req/min)
RATE_LIMIT_TOKEN=5

# Webhook operations (default: 20 req/min)
RATE_LIMIT_WEBHOOK=20
```

## Key Generation

Rate limits are tracked by:
1. **Authenticated users**: User ID (`user:{id}`)
2. **Unauthenticated requests**: IP address (`ip:{address}`)

For auth endpoints, only IP address is used to prevent account enumeration attacks.

## Proxy Support

The middleware supports `X-Forwarded-For` headers for deployments behind proxies (Cloud Run, nginx, load balancers).

## Exemptions

The following are exempt from rate limiting:
- Health check endpoint (`/health`)
- Test environment (`NODE_ENV=test`)

## Best Practices for API Consumers

1. **Implement backoff**: When receiving 429, wait for `Retry-After` seconds
2. **Cache responses**: Reduce unnecessary API calls
3. **Use batch operations**: `batch_update_nodes` instead of individual updates
4. **Monitor headers**: Track `RateLimit-Remaining` to avoid hitting limits

## Example: Handling Rate Limits

```javascript
async function apiRequest(url, options) {
  const response = await fetch(url, options);
  
  if (response.status === 429) {
    const retryAfter = response.headers.get('Retry-After') || 60;
    console.log(`Rate limited. Retrying in ${retryAfter}s`);
    await new Promise(r => setTimeout(r, retryAfter * 1000));
    return apiRequest(url, options); // Retry
  }
  
  return response;
}
```

## Future: Redis Store

For distributed deployments (multiple API instances), a Redis store can be configured to share rate limit counters across instances. Contact support for enterprise rate limiting configuration.
