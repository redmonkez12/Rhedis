import { db } from "#src/db/drizzle";
import { halls } from "#src/db/schema";
import { eq } from "drizzle-orm";

const hallSection = {
    id: halls.id,
    name: halls.name,
    city: halls.city,
};

export async function getAllHalls() {
    return db.select(hallSection).from(halls);
}

export async function getHall(id: string) {
    const [hall] = await db.select(hallSection).from(halls)
        .where(eq(halls.id, id))
        .limit(1);

    return hall;
}