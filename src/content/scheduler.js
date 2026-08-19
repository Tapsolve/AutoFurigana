(function (F) {
    "use strict";

    // Deduplicated, time-sliced work queue.
    // The MutationObserver callback only calls enqueue(); the queue then runs a
    // few milliseconds of work per tick and yields back to the browser.
    function createScheduler(processNode, opts) {
        var options = opts || {};
        var budgetMs = options.budgetMs || 4;
        var idleTimeout = options.idleTimeout || 250;
        var fallbackMs = options.fallbackMs || 40;

        var pending = new Set();
        // Nodes added AFTER the initial scan (MutationObserver discoveries).
        // They are prioritized over every regular pending node so freshly
        // loaded content gets annotated promptly instead of starving behind an
        // ancestor scan that (on a live page) may run effectively forever.
        var freshPending = new Set();
        var scheduled = false;
        var stopped = false;

        function hasPendingAncestor(node) {
            var cur = node.parentNode;
            while (cur) {
                if (pending.has(cur)) return true;
                cur = cur.parentNode;
            }
            return false;
        }

        // `fresh` marks MutationObserver discoveries = newly loaded content.
        function enqueue(node, fresh) {
            if (stopped) return;
            if (!node || (node.nodeType !== 1 && node.nodeType !== 3)) return;
            // Keep descendant mutations even when an ancestor scan is in
            // progress: the TreeWalker may already have passed the insertion
            // point. The Set still deduplicates identical nodes.
            pending.add(node);
            if (fresh && !freshPending.has(node)) freshPending.add(node);
            schedule();
        }

        function schedule() {
            if (scheduled || stopped) return;
            scheduled = true;
            if (typeof requestIdleCallback === "function") {
                requestIdleCallback(runTick, { timeout: idleTimeout });
            } else {
                setTimeout(runTick, fallbackMs);
            }
        }

        function runTick(deadline) {
            scheduled = false;
            if (stopped) return;

            var start = Date.now();
            var budget = budgetMs;
            if (deadline && typeof deadline.timeRemaining === "function") {
                var remaining = deadline.timeRemaining();
                if (remaining > 0 && remaining < budgetMs) budget = Math.max(remaining, 2);
            }

            while (pending.size > 0 && Date.now() - start < budget) {
                var node = takeHighestRoot();
                if (!node) break;
                try {
                    // Remove the active root while processing so a
                    // continuation can be queued without being mistaken
                    // for a duplicate pending ancestor.
                    pending.delete(node);
                    var done = processNode(node) !== false;
                    // A fresh root keeps its priority across continuation
                    // scans, so a large freshly-inserted subtree is fully
                    // annotated before the backlog gets a turn.
                    if (!done && !stopped) pending.add(node);
                    if (done) freshPending.delete(node);
                } catch (err) {
                    // Never let one bad node kill the queue.
                    if (typeof console !== "undefined" && console.error) console.error(err);
                }
            }

            if (pending.size > 0) schedule();
        }

        function takeHighestRoot() {
            if (pending.size === 0) return null;
            // Newly loaded content always wins, so lazy text is annotated
            // promptly no matter how large the analysis backlog is.
            for (var fresh of freshPending) {
                if (pending.has(fresh)) return fresh;
            }
            for (var node of pending) {
                if (!hasPendingAncestor(node)) return node;
            }
            // Everything pending sits under a still-scanned ancestor: take the
            // newest (insertion-order last) pending node so the queue can
            // never stall on new content.
            var last = null;
            for (var n of pending) last = n;
            return last;
        }

        function size() {
            return pending.size;
        }

        function clear() {
            pending.clear();
            freshPending.clear();
        }

        function stop() {
            stopped = true;
            pending.clear();
            freshPending.clear();
        }

        return { enqueue: enqueue, size: size, clear: clear, stop: stop };
    }

    F.scheduler = { createScheduler: createScheduler };
})(globalThis.__FURIGANA__);