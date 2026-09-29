/* What pressing "Confirm" does, in order. Kept apart from the request
   handler, with its effects passed in, so the order — the one thing here
   that must not be got wrong — is tested without a database. */

/**
 * @param {{ discount_code: string | null }} sub  the pending subscriber
 * @param {{
 *   offer: boolean,                        the welcome offer is on, and they have no code yet
 *   mintCode: () => Promise<string>,       make a code in the cloud service
 *   storeCode: (code: string) => Promise<string>,  keep it on the row; returns the one kept
 *   confirm: () => Promise<unknown>,       mark the subscription confirmed
 *   sendCode: (code: string) => Promise<unknown>,  email a copy
 *   log?: (message: string) => void,
 * }} fx
 * @returns {Promise<{ ok: false } | { ok: true, code: string | null, sent: boolean }>}
 */
export async function confirmSubscription(sub, fx) {
  const log = fx.log ?? (() => {});
  let code = sub.discount_code ?? null;

  /* The code first, then the confirmation. If the cloud service cannot
     make one, nothing is confirmed yet and pressing again tries again — no
     subscriber is ever left confirmed and owed a code. */
  if (fx.offer && !code) {
    try {
      code = await fx.storeCode(await fx.mintCode());
    } catch (err) {
      log(`minting the code failed: ${err.message}`);
      return { ok: false };
    }
  }

  await fx.confirm();

  /* The page shows the code whatever happens here; the email is a copy to
     keep, and its failure is not the subscriber's problem. */
  let sent = false;
  if (code) {
    try {
      await fx.sendCode(code);
      sent = true;
    } catch (err) {
      log(`the code email failed: ${err.message}`);
    }
  }
  return { ok: true, code, sent };
}
