import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useAppFeedbackPopup } from '@/hooks/useAppFeedbackPopup';
import AppFeedbackModal from './AppFeedbackModal';

const POPUP_DELAY_MS = 3000;
// Solo aparece en estas rutas — evita interrumpir flows críticos
// (subida de extractos, conciliación, etc.).
const ELIGIBLE_PATHS = ['/dashboard'];

export default function AppFeedbackPopupHost() {
  const { shouldShow, dismissForNow, markSubmitted } = useAppFeedbackPopup();
  const [open, setOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    if (!shouldShow) return;
    if (!ELIGIBLE_PATHS.includes(location.pathname)) return;

    const timer = setTimeout(() => setOpen(true), POPUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [shouldShow, location.pathname]);

  if (!open) return null;

  return (
    <AppFeedbackModal
      open={open}
      onClose={() => setOpen(false)}
      onSubmitted={() => {
        setOpen(false);
        markSubmitted();
      }}
      onPostpone={async () => {
        setOpen(false);
        await dismissForNow();
      }}
    />
  );
}
