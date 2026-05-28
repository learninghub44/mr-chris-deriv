/**
 * Diagnostics and Root-Cause Analysis Utilities
 * 
 * Sets up global error handlers for uncaught exceptions and unhandled promise rejections.
 * Also includes a memory monitor for detecting potential memory leaks in the browser.
 */

let cleanupDiagnostics: (() => void) | null = null;

export const setupDiagnostics = () => {
    if (cleanupDiagnostics) return cleanupDiagnostics;

    const handleError = (event: ErrorEvent) => {
        console.error('[Diagnostics] Uncaught Exception:', {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            colno: event.colno,
            error: event.error,
        });
        // Here you could send this to an external logging service.
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
        console.error('[Diagnostics] Unhandled Promise Rejection:', {
            reason: event.reason,
        });
    };

    // 1. Global Error Handlers (equivalent to process.on in Node.js)
    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    // 2. Memory Monitor
    const MEMORY_THRESHOLD_MB = 500; // Flag if heap grows beyond 500MB
    
    const checkMemory = () => {
        const perf = window.performance as any;
        if (perf && perf.memory) {
            const usedHeapMB = Math.round(perf.memory.usedJSHeapSize / (1024 * 1024));
            const totalHeapMB = Math.round(perf.memory.totalJSHeapSize / (1024 * 1024));
            const limitMB = Math.round(perf.memory.jsHeapSizeLimit / (1024 * 1024));

            if (usedHeapMB > MEMORY_THRESHOLD_MB) {
                console.warn(
                    `[Diagnostics] High Memory Usage Detected: ${usedHeapMB}MB used of ${totalHeapMB}MB allocated (Limit: ${limitMB}MB). Possible memory leak.`
                );
            }
        }
    };

    // Check memory every 30 seconds
    const memoryInterval = setInterval(checkMemory, 30000);

    cleanupDiagnostics = () => {
        window.removeEventListener('error', handleError);
        window.removeEventListener('unhandledrejection', handleUnhandledRejection);
        clearInterval(memoryInterval);
        cleanupDiagnostics = null;
    };

    return cleanupDiagnostics;
};
