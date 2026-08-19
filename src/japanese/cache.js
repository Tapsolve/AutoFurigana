(function (F) {
    "use strict";

    // Bounded, RAM-only LRU cache. Uses Map insertion order for eviction.
    // Cache is never persisted and dies with the content-script context.
    function createLRU(maxEntries) {
        var max = maxEntries || 3000;
        var map = new Map();

        function get(key) {
            if (!map.has(key)) return undefined;
            var value = map.get(key);
            map.delete(key);
            map.set(key, value);
            return value;
        }

        function set(key, value) {
            if (map.has(key)) map.delete(key);
            map.set(key, value);
            while (map.size > max) {
                map.delete(map.keys().next().value);
            }
            return value;
        }

        function has(key) {
            return map.has(key);
        }

        function delete_(key) {
            return map.delete(key);
        }

        function clear() {
            map.clear();
        }

        function size() {
            return map.size;
        }

        return { get: get, set: set, has: has, delete: delete_, clear: clear, size: size };
    }

    F.cache = { createLRU: createLRU };
})(globalThis.__FURIGANA__);
