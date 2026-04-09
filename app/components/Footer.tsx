'use client';
import { useI18n } from '../lib/i18n';

export default function Footer() {
  const { t } = useI18n();

  return (
    <div className="text-center text-[#4a5a70] text-xs mt-8 pt-6 border-t border-[#1e2a3a]">
      metastats.gg · {t('footer.disclaimer')}
    </div>
  );
}
