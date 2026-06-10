import { randomUUID } from "node:crypto";
import type { PublicBrandingContext, RequestContext } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { eq } from "drizzle-orm";
import type { AnyDatabase, PostgresDatabase } from "../types.js";
import { isSqlite } from "../types.js";
import { organizations as sqliteOrgs } from "../schema/sqlite.js";
import { organizations as pgOrgs } from "../schema/pg.js";
import { now } from "./baseRepo.js";

export function createOrganizationRepo(db: AnyDatabase) {
  return {
    async create(
      _ctx: RequestContext,
      input: { name: string; displayName: string; slug: string },
    ) {
      const timestamp = now();
      const organization = {
        id: randomUUID(),
        ...input,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      if (isSqlite(db)) {
        db.insert(sqliteOrgs).values(organization).run();
      } else {
        await (db as PostgresDatabase).insert(pgOrgs).values(organization);
      }
      return organization;
    },
    async findById(_ctx: RequestContext, id: string) {
      if (isSqlite(db)) {
        return (
          db.select().from(sqliteOrgs).where(eq(sqliteOrgs.id, id)).get() ??
          null
        );
      }
      const rows = await (db as PostgresDatabase)
        .select()
        .from(pgOrgs)
        .where(eq(pgOrgs.id, id));
      return rows[0] ?? null;
    },
    async list(_ctx: RequestContext) {
      if (isSqlite(db)) {
        return db.select().from(sqliteOrgs).all();
      }
      return (db as PostgresDatabase).select().from(pgOrgs);
    },
    async update(
      _ctx: RequestContext,
      id: string,
      input: Partial<{ name: string; displayName: string; slug: string }>,
    ) {
      const changes = { ...input, updatedAt: now() };
      if (isSqlite(db)) {
        db.update(sqliteOrgs).set(changes).where(eq(sqliteOrgs.id, id)).run();
        return (
          db.select().from(sqliteOrgs).where(eq(sqliteOrgs.id, id)).get() ??
          null
        );
      }
      await (db as PostgresDatabase)
        .update(pgOrgs)
        .set(changes)
        .where(eq(pgOrgs.id, id));
      const rows = await (db as PostgresDatabase)
        .select()
        .from(pgOrgs)
        .where(eq(pgOrgs.id, id));
      return rows[0] ?? null;
    },
    async delete(_ctx: RequestContext, id: string) {
      if (isSqlite(db)) {
        return (
          db.delete(sqliteOrgs).where(eq(sqliteOrgs.id, id)).run().changes > 0
        );
      }
      const result = await (db as PostgresDatabase)
        .delete(pgOrgs)
        .where(eq(pgOrgs.id, id));
      return (result.count ?? 0) > 0;
    },
    async resolveBrandingTenant(_ctx: PublicBrandingContext, slug?: string) {
      if (isSqlite(db)) {
        const organization = slug
          ? db.select().from(sqliteOrgs).where(eq(sqliteOrgs.slug, slug)).get()
          : db.select().from(sqliteOrgs).limit(1).get();

        if (!organization) {
          throw new NotFoundError("Branding organization not found");
        }
        return organization;
      }
      const rows = slug
        ? await (db as PostgresDatabase)
            .select()
            .from(pgOrgs)
            .where(eq(pgOrgs.slug, slug))
        : await (db as PostgresDatabase).select().from(pgOrgs).limit(1);
      const organization = rows[0];
      if (!organization) {
        throw new NotFoundError("Branding organization not found");
      }
      return organization;
    },
  };
}
