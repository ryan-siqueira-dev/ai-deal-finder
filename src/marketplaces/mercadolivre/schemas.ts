import { z } from "zod";

export const mlAttributeSchema = z.object({
  id: z.string(),
  name: z.string(),
  value_id: z.string().nullable().optional(),
  value_name: z.string().nullable().optional(),
}).passthrough();

const mlAddressSchema = z.object({
  city_name: z.string().nullable().optional(),
  state_name: z.string().nullable().optional(),
}).passthrough().nullable().optional();

export const mlSearchItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  price: z.number().nullable(),
  currency_id: z.string().nullable(),
  permalink: z.string().url(),
  thumbnail: z.string().url().nullable().optional(),
  address: mlAddressSchema,
  seller: z.object({ id: z.number().optional(), nickname: z.string().nullable().optional() }).passthrough().optional(),
  attributes: z.array(mlAttributeSchema).default([]),
}).passthrough();

export const mlSearchResponseSchema = z.object({
  paging: z.object({ total: z.number(), offset: z.number(), limit: z.number() }),
  results: z.array(mlSearchItemSchema),
}).passthrough();

export const mlItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  price: z.number().nullable(),
  currency_id: z.string().nullable(),
  permalink: z.string().url(),
  thumbnail: z.string().url().nullable().optional(),
  pictures: z.array(z.object({ secure_url: z.string().url().optional(), url: z.string().url().optional() }).passthrough()).default([]),
  seller_id: z.number().optional(),
  seller_address: z.object({
    city: z.object({ name: z.string().nullable().optional() }).optional(),
    state: z.object({ name: z.string().nullable().optional() }).optional(),
  }).passthrough().nullable().optional(),
  attributes: z.array(mlAttributeSchema).default([]),
  date_created: z.string().datetime({ offset: true }).nullable().optional(),
}).passthrough();

export const mlDescriptionSchema = z.object({
  plain_text: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
}).passthrough();

export type MlSearchItem = z.infer<typeof mlSearchItemSchema>;
export type MlItem = z.infer<typeof mlItemSchema>;
