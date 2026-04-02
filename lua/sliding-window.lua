local key    = KEYS[1]
local limit  = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local now    = tonumber(ARGV[3])

local window_start = now - (window * 1000)

redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

local count = tonumber(redis.call('ZCARD', key))

if count >= limit then
  local oldest = tonumber(redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')[2] or now)
  local reset_at = math.floor((oldest + window * 1000) / 1000)
  return { 0, 0, reset_at }
end

-- Add current request and set expiry
redis.call('ZADD', key, now, now .. '-' .. math.random(1, 99999))
redis.call('PEXPIRE', key, window * 1000)

-- remaining after this allowed request
return { 1, limit - count - 1, math.floor((now + window * 1000) / 1000) }
