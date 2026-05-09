/**
 * Classe de base pour toutes les erreurs applicatives typées.
 * Permet de distinguer les erreurs métier des erreurs système via `instanceof`.
 */
export class AppError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Erreur levée lorsqu'une ressource demandée est introuvable.
 * Correspond au statut HTTP 404.
 */
export class NotFoundError extends AppError {}

/**
 * Erreur levée lorsque l'utilisateur n'est pas authentifié.
 * Correspond au statut HTTP 401.
 */
export class UnauthorizedError extends AppError {}

/**
 * Erreur levée lorsque l'utilisateur n'a pas les droits nécessaires.
 * Correspond au statut HTTP 403.
 */
export class ForbiddenError extends AppError {}

/**
 * Erreur levée en cas de conflit avec l'état actuel de la ressource.
 * Correspond au statut HTTP 409.
 */
export class ConflictError extends AppError {}

/**
 * Erreur levée lorsque la validation des données d'entrée échoue.
 * Correspond au statut HTTP 400.
 */
export class ValidationError extends AppError {}

/**
 * Erreur levée lorsque l'envoi d'un email échoue.
 * Correspond au statut HTTP 502.
 */
export class EmailDeliveryError extends AppError {}
