local key          = KEYS[1]
local capacity     = tonumber(ARGV[1])
local refill_rate  = tonumber(ARGV[2])
local now          = tonumber(ARGV[3])

local data = redis.call('HMGET', key, 'tokens', 'last_refill')
local tokens      = tonumber(data[1] or capacity)
local last_refill = tonumber(data[2] or now)

local elapsed_seconds = (now - last_refill) / 1000
local refill_amount   = elapsed_seconds * refill_rate
tokens = math.min(capacity, tokens + refill_amount)

if tokens < 1 then
  local wait_seconds = (1 - tokens) / refill_rate
  return { 0, 0, math.floor(now / 1000 + wait_seconds) }
end

tokens = tokens - 1
redis.call('HMSET', key, 'tokens', tokens, 'last_refill', now)
redis.call('EXPIRE', key, math.ceil(capacity / refill_rate) + 1)

-- remaining after consuming one token (floor)
return { 1, math.floor(tokens), math.floor(now / 1000 + (capacity - tokens) / refill_rate) }
