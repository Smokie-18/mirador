// backend/db/seed.js
// Run: npm run seed
//
// Clears all data and inserts realistic demo data for every page of the app.
// Safe to re-run (TRUNCATE CASCADE wipes everything first).
//
// Demo accounts created (all password: password123):
//   admin@mirador.com   → admin
//   renata@maison.fr    → host  (owns Maison Calvet + Hotel Bjørk + Sancta Maria)
//   diego@mirador.es    → host  (owns Casa del Mirador + The Larkspur)
//   avery@calder.studio → guest (has 1 past + 1 upcoming booking, 1 review)
//   lina@marchetti.co   → guest (has 1 past + 1 upcoming booking, 1 review)

import pkg     from 'pg';
import bcrypt  from 'bcrypt';
import dotenv  from 'dotenv';

dotenv.config();

const { Pool } = pkg;

const pool = new Pool({
  user:     process.env.DB_USER,
  host:     process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port:     Number(process.env.DB_PORT) || 5432,
});

// ─────────────────────────────────────────────────────────────────────────────

const run = async () => {
  const client = await pool.connect();

  try {
    console.log('\n Seeding Mirador database…\n');

    // ── 0. WIPE ───────────────────────────────────────────────────────────
    // FK order doesn't matter with CASCADE — Postgres resolves it.
    await client.query(
      'TRUNCATE reviews, bookings, hotel_images, rooms, hotels, users CASCADE'
    );
    console.log('   Cleared existing data\n');

    // ── 1. USERS ──────────────────────────────────────────────────────────
    const hash = await bcrypt.hash('password123', 10);

    const { rows: users } = await client.query(
      `INSERT INTO users (name, email, password_hash, role, auth_provider) VALUES
        ('Mirador Admin',  'admin@mirador.com',       $1, 'admin', 'local'),
        ('Renata Salgado', 'renata@maison.fr',         $1, 'host',  'local'),
        ('Diego Aragón',   'diego@mirador.es',         $1, 'host',  'local'),
        ('Avery Calder',   'avery@calder.studio',      $1, 'guest', 'local'),
        ('Lina Marchetti', 'lina@marchetti.co',        $1, 'guest', 'local')
       RETURNING id, name, role`,
      [hash]
    );

    const [admin, renata, diego, avery, lina] = users;
    console.log(` Users (${users.length})`);
    users.forEach((u) => console.log(`     ${u.role.padEnd(6)}  ${u.name}`));

    // ── 2. HOTELS ─────────────────────────────────────────────────────────
    const { rows: hotels } = await client.query(
      `INSERT INTO hotels
         (owner_id, name, description, city, country, latitude, longitude, price_per_night)
       VALUES
        ($1, 'Maison Calvet',
         'A 17th-century townhouse in the Marais, restored with restraint. Twelve rooms, no two alike, each with original timber beams and hand-sourced linen.',
         'Paris', 'France', 48.8566, 2.3522, 420),

        ($1, 'Hotel Bjørk',
         'A converted timber warehouse on the Akerselva river. Sustainably built, quietly designed. Sauna, bicycles, and breakfast made from the market next door.',
         'Oslo', 'Norway', 59.9139, 10.7522, 310),

        ($1, 'Sancta Maria',
         'A former pilgrimage hospice with thick stone walls and cool interiors. The owner is a ceramicist — every room has a piece made in the studio below.',
         'Kyoto', 'Japan', 35.0116, 135.7681, 340),

        ($2, 'Casa del Mirador',
         'A Modernista building a ten-minute walk from the Eixample grid. Six suites with private terraces, a rooftop plunge pool, and a wine cellar open to guests every evening.',
         'Barcelona', 'Spain', 41.3851, 2.1734, 380),

        ($2, 'The Larkspur',
         'A Federal-era inn on Warren Street in Hudson. Antiques, a library of first editions, and a kitchen garden that supplies breakfast each morning.',
         'Hudson', 'United States', 42.2529, -73.7898, 275)
       RETURNING id, name`,
      [renata.id, diego.id]
    );

    const [calvet, bjork, sancta, mirador, larkspur] = hotels;
    console.log(`\n✅  Hotels (${hotels.length})`);
    hotels.forEach((h) => console.log(`     ${h.name}`));

    // ── 3. HOTEL IMAGES ───────────────────────────────────────────────────
    // Unsplash photos that match each property's vibe.
    await client.query(
      `INSERT INTO hotel_images (hotel_id, image_url, is_primary) VALUES
        ($1, 'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=1200', true),
        ($2, 'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=1200', true),
        ($3, 'https://images.unsplash.com/photo-1579952363873-27f3bade9f55?w=1200', true),
        ($4, 'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=1200', true),
        ($5, 'https://images.unsplash.com/photo-1510798831971-661eb04b3739?w=1200', true)`,
      [calvet.id, bjork.id, sancta.id, mirador.id, larkspur.id]
    );
    console.log('\n Hotel images (5)');

    // ── 4. ROOMS ──────────────────────────────────────────────────────────
    // Build one multi-row INSERT to keep round-trips low.
    const roomDefs = [
      // Maison Calvet — Parisian pricing
      [calvet.id,   'single', 1, 290],
      [calvet.id,   'double', 2, 420],
      [calvet.id,   'suite',  4, 680],
      // Hotel Bjørk — Nordic mid-range
      [bjork.id,    'single', 1, 210],
      [bjork.id,    'double', 2, 310],
      [bjork.id,    'suite',  3, 490],
      // Sancta Maria — Kyoto boutique
      [sancta.id,   'single', 1, 240],
      [sancta.id,   'double', 2, 340],
      [sancta.id,   'suite',  2, 510],
      // Casa del Mirador — Barcelona premium
      [mirador.id,  'double', 2, 380],
      [mirador.id,  'suite',  4, 620],
      // The Larkspur — Hudson inn
      [larkspur.id, 'single', 1, 185],
      [larkspur.id, 'double', 2, 275],
      [larkspur.id, 'suite',  4, 420],
    ];

    // Dynamically build ($1,$2,$3,$4), ($5,$6,$7,$8), …
    const roomPlaceholders = roomDefs.map((_, i) => {
      const b = i * 4;
      return `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4})`;
    }).join(', ');

    const { rows: rooms } = await client.query(
      `INSERT INTO rooms (hotel_id, room_type, capacity, price_per_night)
       VALUES ${roomPlaceholders}
       RETURNING id, hotel_id, room_type, price_per_night`,
      roomDefs.flat()
    );

    console.log(` Rooms (${rooms.length})`);

    // Handy lookup
    const room = (hotelId, type) =>
      rooms.find((r) => r.hotel_id === hotelId && r.room_type === type);

    const calvetDouble   = room(calvet.id,   'double');   // $420 × 4 = $1,680
    const miradorSuite   = room(mirador.id,  'suite');    // $620 × 4 = $2,480
    const bjorkDouble    = room(bjork.id,    'double');   // $310 × 4 = $1,240
    const larkspurDouble = room(larkspur.id, 'double');   // $275 × 4 = $1,100
    const sanctaDouble   = room(sancta.id,   'double');   // $340 × 3 = $1,020

    // ── 5. BOOKINGS ───────────────────────────────────────────────────────
    // Past bookings (check_out < today) → eligible for reviews
    // Upcoming bookings (check_in > today) → appear in dashboard

    // 5a. Avery — past stay at Maison Calvet (double, 4 nights)
    const { rows: [averyCalvet] } = await client.query(
      `INSERT INTO bookings (user_id, room_id, check_in, check_out, guests, total_price, status)
       VALUES ($1, $2, '2026-03-10', '2026-03-14', 2, 1680.00, 'confirmed')
       RETURNING id`,
      [avery.id, calvetDouble.id]
    );

    // 5b. Avery — upcoming stay at Casa del Mirador (suite, 4 nights)
    await client.query(
      `INSERT INTO bookings (user_id, room_id, check_in, check_out, guests, total_price, status)
       VALUES ($1, $2, '2026-07-05', '2026-07-09', 2, 2480.00, 'confirmed')`,
      [avery.id, miradorSuite.id]
    );

    // 5c. Lina — past stay at Hotel Bjørk (double, 4 nights)
    const { rows: [linaBjork] } = await client.query(
      `INSERT INTO bookings (user_id, room_id, check_in, check_out, guests, total_price, status)
       VALUES ($1, $2, '2026-02-20', '2026-02-24', 2, 1240.00, 'confirmed')
       RETURNING id`,
      [lina.id, bjorkDouble.id]
    );

    // 5d. Lina — upcoming stay at The Larkspur (double, 4 nights)
    await client.query(
      `INSERT INTO bookings (user_id, room_id, check_in, check_out, guests, total_price, status)
       VALUES ($1, $2, '2026-08-12', '2026-08-16', 2, 1100.00, 'confirmed')`,
      [lina.id, larkspurDouble.id]
    );

    // 5e. Avery — past stay at Sancta Maria (double, 3 nights) — no review yet
    await client.query(
      `INSERT INTO bookings (user_id, room_id, check_in, check_out, guests, total_price, status)
       VALUES ($1, $2, '2026-01-15', '2026-01-18', 1, 1020.00, 'confirmed')`,
      [avery.id, sanctaDouble.id]
    );

    console.log('\n  Bookings (5)');

    // ── 6. REVIEWS ────────────────────────────────────────────────────────
    // Only for past (confirmed, check_out ≤ today) bookings.
    // Inserting directly bypasses the eligibility check — that's fine for seed data.
    // The DB trigger trg_sync_hotel_rating fires automatically after each INSERT
    // and updates avg_rating + total_reviews on the hotels table.

    // Avery reviews Maison Calvet (her March stay)
    await client.query(
      `INSERT INTO reviews (user_id, hotel_id, booking_id, rating, comment) VALUES
        ($1, $2, $3, 5,
         'One of the best stays I''ve had in Paris. The room had the original fireplace still working — they lit it without being asked. Breakfast is served until 11, which is rare. Will be back in autumn.')`,
      [avery.id, calvet.id, averyCalvet.id]
    );

    // Lina reviews Hotel Bjørk (her February stay)
    await client.query(
      `INSERT INTO reviews (user_id, hotel_id, booking_id, rating, comment) VALUES
        ($1, $2, $3, 5,
         'The sauna at midnight with snow outside and the river below — that''s it, that''s the review. The staff knew our names by dinner. Breakfast is absurdly good for a place this size.')`,
      [lina.id, bjork.id, linaBjork.id]
    );

    // Admin leaves an older review for Casa del Mirador (need a booking first)
    const calvetSuite = room(calvet.id, 'suite');
    const { rows: [adminCalvet] } = await client.query(
      `INSERT INTO bookings (user_id, room_id, check_in, check_out, guests, total_price, status)
       VALUES ($1, $2, '2025-11-03', '2025-11-07', 2, 2720.00, 'confirmed')
       RETURNING id`,
      [admin.id, calvetSuite.id]
    );
    await client.query(
      `INSERT INTO reviews (user_id, hotel_id, booking_id, rating, comment) VALUES
        ($1, $2, $3, 4,
         'Exceptional property. The suite on the top floor has views over the rooftops that don''t show up in photos. My only note: the WiFi drops in the back rooms. Everything else is near-perfect.')`,
      [admin.id, calvet.id, adminCalvet.id]
    );

    console.log(' Reviews (3)');
    console.log('   (avg_rating + total_reviews updated automatically via DB trigger)\n');

    // ── 7. VERIFY ─────────────────────────────────────────────────────────
    const { rows: check } = await client.query(
      `SELECT name, avg_rating, total_reviews FROM hotels ORDER BY name`
    );
    console.log(' Hotel ratings after seed:');
    check.forEach((h) =>
      console.log(`     ${h.name.padEnd(22)} ★ ${h.avg_rating}  (${h.total_reviews} review${h.total_reviews === 1 ? '' : 's'})`)
    );

    console.log('\n─────────────────────────────────────────');
    console.log('  Seed complete!\n');
    console.log('   Demo accounts (password: password123)');
    console.log('   ─────────────────────────────────────');
    console.log('   admin@mirador.com       admin');
    console.log('   renata@maison.fr        host  (3 hotels)');
    console.log('   diego@mirador.es        host  (2 hotels)');
    console.log('   avery@calder.studio     guest (2 bookings, 1 review)');
    console.log('   lina@marchetti.co       guest (2 bookings, 1 review)');
    console.log('─────────────────────────────────────────\n');

  } catch (err) {
    console.error('\n  Seed failed:', err.message);
    console.error(err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
};

run();
