import { z } from 'zod';

/** Request payload for the `app:ping` liveness channel. */
export const PingRequestSchema = z.object({
  sentAt: z.number().finite()
});
export type PingRequest = z.infer<typeof PingRequestSchema>;

/** Response payload for the `app:ping` liveness channel. */
export const PingResponseSchema = z
  .object({
    pong: z.literal(true),
    receivedAt: z.number().finite(),
    echoSentAt: z.number().finite().optional()
  })
  .strict();
export type PingResponse = z.infer<typeof PingResponseSchema>;
