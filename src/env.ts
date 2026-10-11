import "dotenv/config";

// Satu-satunya env yang dibutuhkan; sisanya (token dll) diatur lewat dashboard web.
process.env.DATABASE_URL ??= "file:./dev.db";
