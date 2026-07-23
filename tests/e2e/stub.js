// Client Supabase SIMULE — remplace le bundle CDN pendant les tests Playwright.
// Aucun appel reseau reel. Aucun compte distant. Aucune URL de production utilisee.
(function () {
  const S = window.__SCENARIO__ || {};
  const C = (window.__CALLS__ = {
    enroll: 0, unenroll: 0, listFactors: 0, challengeAndVerify: 0,
    getUser: 0, profil: 0, bootstrap: 0, dernierNom: null, unenrolled: [],
  });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms || 0));
  const lat = () => sleep(S.latence || 0);

  let facteurs = JSON.parse(JSON.stringify(S.facteurs || { all: [], totp: [], phone: [] }));
  let aal = S.aal || 'aal1';

  const session = { access_token: 'jeton-simule', user: { id: 'UTILISATEUR-TEST' } };

  const profil = {
    agent_code: 'ZZTEST', display_name: 'Agent Test', job_title: 'Test',
    module: 'sevci', permissions: ['sevci_data'], building: null,
    is_chef: false, active: true,
  };

  function tableStub(nom) {
    const api = {
      select: () => api, eq: () => api, order: () => api, limit: () => api,
      in: () => api, gte: () => api, lte: () => api, neq: () => api,
      single: async () => {
        await lat();
        if (nom === 'csa_profiles') { C.profil++;
          if (S.profilErreur) return { data: null, error: S.profilErreur };
          return { data: profil, error: null }; }
        return { data: null, error: null };
      },
      then: (res) => Promise.resolve({ data: [], error: null }).then(res),
      insert: async () => ({ data: null, error: null }),
      upsert: async () => ({ data: null, error: null }),
      update: async () => ({ data: null, error: null }),
    };
    return api;
  }

  function client() {
    const listeners = [];
    return {
      from: tableStub,
      rpc: async () => ({ data: null, error: null }),
      auth: {
        onAuthStateChange: (cb) => {
          listeners.push(cb);
          // Evenement Auth concurrent de getSession() -> reproduit la double initialisation
          setTimeout(() => cb('INITIAL_SESSION', S.sansSession ? null : session), S.decalageAuth || 0);
          return { data: { subscription: { unsubscribe() {} } } };
        },
        getSession: async () => { await lat(); return { data: { session: S.sansSession ? null : session } }; },
        getUser: async () => { C.getUser++; await lat(); return { data: { user: { id: session.user.id, factors: facteurs.all } }, error: null }; },
        signInWithPassword: async () => { await lat(); listeners.forEach((cb) => cb('SIGNED_IN', session)); return { data: { session }, error: null }; },
        signOut: async () => { listeners.forEach((cb) => cb('SIGNED_OUT', null)); return { error: null }; },
        mfa: {
          getAuthenticatorAssuranceLevel: async () => {
            await lat();
            if (S.aalErreur) return { data: null, error: S.aalErreur };
            return { data: { currentLevel: aal }, error: null };
          },
          listFactors: async () => {
            C.listFactors++; await lat();
            if (S.listErreur) return { data: null, error: S.listErreur };
            return { data: JSON.parse(JSON.stringify(facteurs)), error: null };
          },
          enroll: async (a) => {
            C.enroll++; C.dernierNom = a && a.friendlyName; await lat();
            if (S.enrollErreur) return { data: null, error: S.enrollErreur };
            const f = { id: 'NOUVEAU-' + C.enroll, factor_type: 'totp', status: 'unverified', friendly_name: a.friendlyName };
            facteurs.all.push(f);
            return { data: { id: f.id, totp: { qr_code: 'data:image/png;base64,AAAA', secret: 'SECRET-SIMULE' } }, error: null };
          },
          unenroll: async (a) => {
            C.unenroll++; C.unenrolled.push(a.factorId); await lat();
            if (S.unenrollErreur) return { error: S.unenrollErreur };
            facteurs.all = facteurs.all.filter((f) => f.id !== a.factorId);
            facteurs.totp = (facteurs.totp || []).filter((f) => f.id !== a.factorId);
            return { error: null };
          },
          challengeAndVerify: async () => {
            C.challengeAndVerify++; await lat();
            if (S.verifyErreur) return { error: S.verifyErreur };
            aal = 'aal2';
            return { data: {}, error: null };
          },
        },
      },
    };
  }
  window.supabase = { createClient: () => client() };
})();
