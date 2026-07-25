/**
 * Money is stored as BigInt paise. BigInt has no default JSON representation,
 * so we serialise it as a string. Imported for its side effect by AppModule,
 * ensuring it applies both in `main.ts` and in test harnesses that boot the
 * module directly.
 */
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function toJSON(this: bigint) {
  return this.toString();
};

export {};
