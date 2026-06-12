import { randomUUID } from "node:crypto";
import type { PublicBrandingContext, RequestContext } from "@exam/domain";
import { NotFoundError } from "@exam/domain";
import { eq } from "drizzle-orm";
import type { Database } from "../types.js";
import { organizations } from "../schema/pg.js";
import { now } from "./baseRepo.js";

export function createOrganizationRepo(db: Database) {
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
      await db.insert(organizations).values(organization);
      return organization;
    },
    async findById(_ctx: RequestContext, id: string) {
      const rows = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, id));
      return rows[0] ?? null;
    },
    async list(_ctx: RequestContext) {
      return db.select().from(organizations);
    },
    async update(
      _ctx: RequestContext,
      id: string,
      input: Partial<{ name: string; displayName: string; slug: string }>,
    ) {
      const changes = { ...input, updatedAt: now() };
      await db
        .update(organizations)
        .set(changes)
        .where(eq(organizations.id, id));
      const rows = await db
        .select()
        .from(organizations)
        .where(eq(organizations.id, id));
      return rows[0] ?? null;
    },
    async delete(_ctx: RequestContext, id: string) {
      const result = await db
        .delete(organizations)
        .where(eq(organizations.id, id));
      return (result.count ?? 0) > 0;
    },
    async resolveBrandingTenant(_ctx: PublicBrandingContext, slug?: string) {
      if (slug) {
        const rows = await db
          .select()
          .from(organizations)
          .where(eq(organizations.slug, slug));
        const organization = rows[0];
        if (!organization) {
          throw new NotFoundError("Branding organization not found");
        }
        return organization;
      }
      const all = await db.select().from(organizations);
      if (all.length === 1) return all[0]!;
      throw new NotFoundError(
        all.length === 0
          ? "No organization found"
          : "Multiple organizations exist; organizationSlug is required",
      );
    },
  };
}
