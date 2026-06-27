const { Client } = require('pg');
const { competitionMigrations } = require('../backend/server/competition-schema');

async function run() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
        throw new Error('DATABASE_URL is required to run competition migrations.');
    }

    const client = new Client({
        connectionString,
        ssl: {
            rejectUnauthorized: false,
        },
    });

    await client.connect();

    try {
        for (const migration of competitionMigrations) {
            console.log(`Applying migration: ${migration.name}`);
            await client.query(migration.sql);
        }

        console.log('Competition migrations applied successfully.');
    } finally {
        await client.end();
    }
}

run().catch(error => {
    console.error('Failed to apply competition migrations.');
    console.error(error);
    process.exit(1);
});
