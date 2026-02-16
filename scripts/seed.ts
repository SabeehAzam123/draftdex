import bcrypt from "bcryptjs";
import { connectMongo } from "@/lib/db/mongo";
import { User } from "@/models/User";

async function run() {
    await connectMongo();

    const adminEmail = "admin@test.com";
    const staffEmail = "staff@test.com";

    const adminHash = await bcrypt.hash("Admin123!", 10);
    const staffHash = await bcrypt.hash("Staff123!", 10);

    await User.deleteMany({ email: { $in: [adminEmail, staffEmail] } });

    await User.create([
        { email: adminEmail, passwordHash: adminHash, role: "Admin" },
        { email: staffEmail, passwordHash: staffHash, role: "Staff" },
    ]);

    // Optional: bulk users for pagination
    const bulkCount = 25;
    const bulk = [];
    for (let i = 1; i <= bulkCount; i++) {
        bulk.push({
            email: `staff${i}@test.com`,
            passwordHash: await bcrypt.hash(`Staff${i}123!`, 10),
            role: "Staff" as const,
        });
    }

    // insert ignoring duplicates
    for (const u of bulk) {
        await User.updateOne({ email: u.email }, { $setOnInsert: u }, { upsert: true });
    }

    console.log("Seed complete:");
    console.log("Admin:", adminEmail, "Admin123!");
    console.log("Staff:", staffEmail, "Staff123!");
    process.exit(0);
}

run().catch((e) => {
    console.error(e);
    process.exit(1);
});
