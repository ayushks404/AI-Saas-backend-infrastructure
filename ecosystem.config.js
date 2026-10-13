export default {
    apps: [
        {
            name: 'ai-backend',
            script: 'dist/server.js',
            instances: 'max',          // os.cpus().length workers
            exec_mode: 'cluster',      // Enables cluster port sharing
            max_memory_restart: '1G',  // Blast-radius limiter for memory leaks
            kill_timeout: 30000,       // 30s allows in-flight SSE streams to finish draining
            listen_timeout: 10000,     // 10s wait for DB & Redis to be ready

            env: {
                NODE_ENV: 'development',
                PORT: 3000,
                LOG_LEVEL: 'debug'
            },
            env_production: {
                NODE_ENV: 'production',
                PORT: 3000,
                LOG_LEVEL: 'info'
            },

            out_file: 'logs/pm2-out.log',
            error_file: 'logs/pm2-error.log',
            merge_logs: true,          // Consolidate logs across all workers

            watch: false,              // Never watch files in production
            autorestart: true,
            restart_delay: 1000
        }
    ]
};
