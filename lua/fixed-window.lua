local key     = KEYS[1]
local limit   = tonumber(ARGV[1])
local window  = tonumber(ARGV[2])
local now     = tonumber(ARGV[3])

local count   = tonumber(redis.call('INCR', key))

if count == 1 then
  redis.call('EXPIRE', key, window)
end

if count > limit then
  -- over the limit: remaining is 0, ttl based on key
  local ttl = redis.call('TTL', key)
  return { 0, 0, now + ttl }
end

local ttl = redis.call('TTL', key)
return { 1, limit - count, now + ttl }
