// Aceita ISO, "dd/mm/aaaa" ou "dd/mm/aaaa hh:mm[:ss]" (fuso de Brasília) → ISO UTC
function toIso(v) {
  if (!v) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(String(v).trim());
  const d = br
    ? new Date(`${br[3]}-${br[2]}-${br[1]}T${br[4] || '00'}:${br[5] || '00'}:${br[6] || '00'}-03:00`)
    : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

module.exports = { toIso };
