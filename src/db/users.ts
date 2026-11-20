import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db } from './index.ts';
import { users } from './schema.ts';

export async function getOrCreateUser(params: {
  uid: string;
  email: string;
  name: string;
  role: 'customer' | 'admin';
  passwordHash: string;
}) {
  try {
    const normalizedEmail = params.email.trim().toLowerCase();

    const existingByEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existingByEmail[0]) {
      const updated = await db
        .update(users)
        .set({
          uid: params.uid,
          role: params.role === 'admin' ? 'admin' : existingByEmail[0].role,
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingByEmail[0].id))
        .returning();
      return updated[0] ?? existingByEmail[0];
    }

    const inserted = await db
      .insert(users)
      .values({
        id: `usr-${crypto.randomUUID().slice(0, 8)}`,
        uid: params.uid,
        name: params.name,
        email: normalizedEmail,
        phone: '',
        role: params.role,
        passwordHash: params.passwordHash,
        wishlistProductIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: normalizedEmail,
          name: params.name,
          updatedAt: new Date(),
        },
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Database user upsert failed:', error);
    throw new Error('Unable to synchronize user profile right now. Please try again.', {
      cause: error,
    });
  }
}

export async function getUserByUid(uid: string) {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return rows[0] ?? null;
  } catch (error) {
    console.error('Database user lookup failed:', error);
    throw new Error('Database query failed. Please try again later.', { cause: error });
  }
}
