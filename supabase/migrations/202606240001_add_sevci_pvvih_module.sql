-- ════════════════════════════════════════════════════════
-- SEVCI/PVVIH Module Tables & RLS Policies
-- Migration: 202606240001
-- ════════════════════════════════════════════════════════

BEGIN;

-- ════ SEVCI STAFF TABLE ════
CREATE TABLE IF NOT EXISTS public.sevci_staff (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_staff TEXT UNIQUE NOT NULL,
  fonction TEXT NOT NULL,
  site TEXT NOT NULL DEFAULT '01649',
  phone TEXT,
  email TEXT,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ════ SEVCI PVVIH PATIENTS TABLE ════
CREATE TABLE IF NOT EXISTS public.sevci_pvvih_patients (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  num_dossier TEXT UNIQUE NOT NULL,
  date_inclusion DATE NOT NULL,
  regime_arv TEXT,
  cd4_initial INTEGER,
  charge_virale_date DATE,
  charge_virale_val INTEGER,
  cv_supprimee_date DATE,
  iit_status TEXT CHECK (iit_status IN ('actif','interrompu','perdu','inconnu')),
  ivsa_stade TEXT CHECK (ivsa_stade IN ('stade1','stade2','stade3','stade4','non_applicable')),
  vih_status TEXT DEFAULT 'positif confirmé',
  notes TEXT,
  encrypted_data TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID NOT NULL REFERENCES auth.users(id),
  
  CONSTRAINT unique_pvvih_patient UNIQUE(patient_id, num_dossier)
);

-- ════ SEVCI AUDIT TABLE ════
CREATE TABLE IF NOT EXISTS public.sevci_audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  staff_id UUID NOT NULL REFERENCES public.sevci_staff(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  patient_id UUID REFERENCES public.sevci_pvvih_patients(id) ON DELETE SET NULL,
  details JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ════ ENABLE ROW LEVEL SECURITY ════
ALTER TABLE public.sevci_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sevci_pvvih_patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sevci_audit_logs ENABLE ROW LEVEL SECURITY;

-- ════ RLS POLICIES: SEVCI STAFF ════
CREATE POLICY "SEVCI staff see own record"
  ON public.sevci_staff FOR SELECT
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.csa_profiles p
    WHERE p.user_id = auth.uid() AND p.is_chef
  ));

CREATE POLICY "SEVCI staff create own record"
  ON public.sevci_staff FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "SEVCI staff update own record"
  ON public.sevci_staff FOR UPDATE
  USING (user_id = auth.uid());

-- ════ RLS POLICIES: SEVCI PVVIH PATIENTS ════
CREATE POLICY "SEVCI staff view own patients"
  ON public.sevci_pvvih_patients FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.sevci_staff s
      WHERE s.user_id = auth.uid() AND s.active
    )
  );

CREATE POLICY "SEVCI staff create patient records"
  ON public.sevci_pvvih_patients FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sevci_staff s
      WHERE s.user_id = auth.uid() AND s.active
    ) AND created_by = auth.uid()
  );

CREATE POLICY "SEVCI staff update patient records"
  ON public.sevci_pvvih_patients FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.sevci_staff s
      WHERE s.user_id = auth.uid() AND s.active
    )
  );

CREATE POLICY "SEVCI staff delete own records"
  ON public.sevci_pvvih_patients FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.sevci_staff s
      WHERE s.user_id = auth.uid() AND s.active
    ) AND created_by = auth.uid()
  );

-- ════ RLS POLICIES: SEVCI AUDIT LOGS ════
CREATE POLICY "SEVCI staff view own audit logs"
  ON public.sevci_audit_logs FOR SELECT
  USING (staff_id = (
    SELECT id FROM public.sevci_staff WHERE user_id = auth.uid()
  ));

CREATE POLICY "SEVCI audit auto-create"
  ON public.sevci_audit_logs FOR INSERT
  WITH CHECK (staff_id = (
    SELECT id FROM public.sevci_staff WHERE user_id = auth.uid()
  ));

-- ════ INDEXES ════
CREATE INDEX idx_sevci_staff_user_id ON public.sevci_staff(user_id);
CREATE INDEX idx_sevci_staff_code ON public.sevci_staff(code_staff);
CREATE INDEX idx_sevci_patients_patient_id ON public.sevci_pvvih_patients(patient_id);
CREATE INDEX idx_sevci_patients_num_dossier ON public.sevci_pvvih_patients(num_dossier);
CREATE INDEX idx_sevci_patients_iit ON public.sevci_pvvih_patients(iit_status);
CREATE INDEX idx_sevci_patients_ivsa ON public.sevci_pvvih_patients(ivsa_stade);
CREATE INDEX idx_sevci_audit_staff ON public.sevci_audit_logs(staff_id);
CREATE INDEX idx_sevci_audit_patient ON public.sevci_audit_logs(patient_id);
CREATE INDEX idx_sevci_audit_created ON public.sevci_audit_logs(created_at DESC);

-- ════ UPDATE CSA PROFILES - ADD SEVCI PERMISSION ════
-- Note: Run this manually via Supabase UI or as separate migration if csa_profiles exists
-- ALTER TABLE public.csa_profiles ADD COLUMN IF NOT EXISTS permissions TEXT[] DEFAULT array[]::TEXT[];

COMMIT;

-- ════ VERIFICATION QUERIES ════
-- SELECT COUNT(*) FROM public.sevci_staff;
-- SELECT COUNT(*) FROM public.sevci_pvvih_patients;
-- SELECT * FROM public.sevci_audit_logs ORDER BY created_at DESC LIMIT 10;
