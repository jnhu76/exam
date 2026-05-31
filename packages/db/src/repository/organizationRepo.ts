import { randomUUID } from "node:crypto";
import type { PublicBrandingContext, RequestContext } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { eq } from "drizzle-orm";
import type { SqliteDatabase } from "../sqlite.js";
import { organizations } from "../schema/sqlite.js";
import { now } from "./baseRepo.js";

export function createOrganizationRepo(db: SqliteDatabase) {
  return {
    create(
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
      db.insert(organizations).values(organization).run();
      return organization;
    },
    findById(_ctx: RequestContext, id: string) {
      return (
        db.select().from(organizations).where(eq(organizations.id, id)).get() ??
        null
      );
    },
    list(_ctx: RequestContext) {
      return db.select().from(organizations).all();
    },
    update(
      _ctx: RequestContext,
      id: string,
      input: Partial<{ name: string; displayName: string; slug: string }>,
    ) {
      db.update(organizations)
        .set({ ...input, updatedAt: now() })
        .where(eq(organizations.id, id))
        .run();
      return (
        db.select().from(organizations).where(eq(organizations.id, id)).get() ??
        null
      );
    },
    delete(_ctx: RequestContext, id: string) {
      return (
        db.delete(organizations).where(eq(organizations.id, id)).run().changes >
        0
      );
    },
    resolveBrandingTenant(_ctx: PublicBrandingContext, slug?: string) {
      const organization = slug
        ? db
            .select()
            .from(organizations)
            .where(eq(organizations.slug, slug))
            .get()
        : db.select().from(organizations).limit(1).get();

      if (!organization) {
        throw new NotFoundError("Branding organization not found");
      }
      return organization;
    },
  };
}
