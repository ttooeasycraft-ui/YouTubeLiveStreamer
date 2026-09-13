import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const usuariosTable = pgTable("usuarios", {
  googleSub: text("google_sub").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  picture: text("picture"),
  firstLoginAt: timestamp("first_login_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertUsuarioSchema = createInsertSchema(usuariosTable).omit({
  firstLoginAt: true,
  lastLoginAt: true,
});

export type InsertUsuario = z.infer<typeof insertUsuarioSchema>;
export type Usuario = typeof usuariosTable.$inferSelect;