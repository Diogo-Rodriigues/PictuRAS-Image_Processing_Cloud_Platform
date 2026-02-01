const LOCK_TIMEOUT_MS = 100; // 100 ms

/**
 * Verifica se um lock expirou (mais de 10 minutos)
 * @param {Date} lockedAt - Timestamp de quando o lock foi adquirido
 * @returns {boolean} - true se expirou
 */
function isLockExpired(lockedAt) {
  if (!lockedAt) return true;
  const now = new Date();
  const lockAge = now - new Date(lockedAt);
  return lockAge > LOCK_TIMEOUT_MS;
}

/**
 * Verifica se o projeto tem um lock ativo e não expirado
 * @param {Object} project - Documento do projeto
 * @returns {boolean} - true se tem lock ativo
 */
function hasActiveLock(project) {
  if (!project.lockedBy) return false;
  return !isLockExpired(project.lockedAt);
}

/**
 * Limpa o lock de um projeto (seta campos para null)
 * @param {Object} project - Documento do projeto
 */
function clearLock(project) {
  project.lockedBy = null;
  project.lockedAt = null;
  project.lockedUserName = null;
}

/**
 * Verifica se um utilizador pode adquirir o lock
 * @param {String} userId - ID do utilizador
 * @param {Object} project - Documento do projeto
 * @param {Object} shareLink - Link de partilha (se acesso via share link)
 * @returns {Object} - { canLock: boolean, reason?: string }
 */
function canUserEdit(userId, project, shareLink = null) {
  // Owner sempre pode editar
  if (project.user_id.toString() === userId) {
    return { canLock: true };
  }

  // Se tem share link, verificar permissão
  if (shareLink) {
    if (shareLink.permission === "EDIT" && !shareLink.revoked) {
      return { canLock: true };
    }
    return { canLock: false, reason: "insufficient_permissions" };
  }

  // Sem share link e não é owner
  return { canLock: false, reason: "not_authorized" };
}

/**
 * Calcula tempo restante até expiração do lock (em segundos)
 * @param {Date} lockedAt - Timestamp de quando o lock foi adquirido
 * @returns {number} - Segundos restantes (0 se expirado)
 */
function getTimeUntilExpiry(lockedAt) {
  if (!lockedAt) return 0;
  const now = new Date();
  const lockAge = now - new Date(lockedAt);
  const remaining = LOCK_TIMEOUT_MS - lockAge;
  return Math.max(0, Math.floor(remaining / 1000));
}

module.exports = {
  LOCK_TIMEOUT_MS,
  isLockExpired,
  hasActiveLock,
  clearLock,
  canUserEdit,
  getTimeUntilExpiry,
};
