/**
 * Debounced serial work queue — coalesces burst events into one flush, chains if flush re-schedules.
 */
export function createDebouncedQueue(run, debounceMs = 50) {
    let timer = null;
    let running = false;
    let pending = false;

    function schedule() {
        pending = true;
        clearTimeout(timer);
        timer = setTimeout(flush, debounceMs);
    }

    function cancel() {
        clearTimeout(timer);
        timer = null;
        pending = false;
    }

    function flush() {
        timer = null;
        if (running) {
            pending = true;
            return;
        }
        pending = false;
        running = true;
        try {
            run();
        } finally {
            running = false;
            if (pending) schedule();
        }
    }

    return { schedule, cancel };
}
