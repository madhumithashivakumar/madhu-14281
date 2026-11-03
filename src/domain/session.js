/**
 * @file session.js
 * @description State machine for session lifecycle and hermetic rating aggregation.
 * Enforces valid state transitions and defensible business rules.
 * Pure zero-dependency Node.js ESM.
 */

import {
  SessionStatus,
  InvalidStateTransitionError,
  InvalidRatingError,
  ok,
  err,
} from './types.js';

/**
 * SessionStateMachine enforces strict unidirectional lifecycle transitions:
 * UPCOMING -> LIVE -> ENDED
 */
export class SessionStateMachine {
  /**
   * Evaluates and applies a state transition to an event session.
   *
   * @param {Object} session
   * @param {string} session.status Current session status
   * @param {string} targetStatus Target session status
   * @param {number} [nowMs=Date.now()] Timestamp of the transition in milliseconds
   * @returns {{ ok: true, value: Object, error: null } | { ok: false, value: null, error: InvalidStateTransitionError }}
   */
  static transition(session, targetStatus, nowMs = Date.now()) {
    if (!session || typeof session !== 'object') {
      return err(
        new InvalidStateTransitionError(
          'UNDEFINED',
          String(targetStatus),
          'Session must be a valid object'
        )
      );
    }

    const currentStatus = session.status;
    const resolvedNowMs = (typeof nowMs === 'number' && Number.isFinite(nowMs) && nowMs > 0)
      ? nowMs
      : Date.now();

    // Valid transitions matrix
    const isValidTransition =
      (currentStatus === SessionStatus.UPCOMING && targetStatus === SessionStatus.LIVE) ||
      (currentStatus === SessionStatus.LIVE && targetStatus === SessionStatus.ENDED);

    if (!isValidTransition) {
      return err(
        new InvalidStateTransitionError(
          currentStatus,
          targetStatus,
          `Cannot transition session from '${currentStatus}' to '${targetStatus}'. Allowed: UPCOMING -> LIVE -> ENDED.`
        )
      );
    }

    const updatedSession = {
      ...session,
      status: targetStatus,
      updatedAtMs: resolvedNowMs,
    };

    if (targetStatus === SessionStatus.LIVE && !updatedSession.actualStartTimeMs) {
      updatedSession.actualStartTimeMs = resolvedNowMs;
    }

    if (targetStatus === SessionStatus.ENDED && !updatedSession.actualEndTimeMs) {
      updatedSession.actualEndTimeMs = resolvedNowMs;
    }

    return ok(Object.freeze(updatedSession));
  }
}

/**
 * RatingCalculator validates and calculates rolling averages for attendee ratings.
 */
export class RatingCalculator {
  /**
   * Validates and appends a rating to a session, returning an updated session with recalculated averageRating.
   *
   * @param {Object} session
   * @param {Object} ratingParams
   * @param {string} ratingParams.deviceId Unique device identifier
   * @param {number} ratingParams.stars Integer rating in [1, 5]
   * @param {string} [ratingParams.comment] Optional participant review text
   * @param {number} [ratingParams.createdAtMs=Date.now()]
   * @returns {{ ok: true, value: Object, error: null } | { ok: false, value: null, error: InvalidRatingError }}
   */
  static addRating(session, { deviceId, stars, comment, createdAtMs = Date.now() }) {
    if (!session || typeof session !== 'object') {
      return err(new InvalidRatingError(stars, 'Session must be a valid object'));
    }

    if (typeof deviceId !== 'string' || deviceId.trim().length === 0) {
      return err(new InvalidRatingError(stars, 'Rating deviceId must be a non-empty string'));
    }

    if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
      return err(
        new InvalidRatingError(
          stars,
          `Rating stars must be an integer between 1 and 5 (received ${stars})`
        )
      );
    }

    const resolvedCreatedAtMs = (typeof createdAtMs === 'number' && Number.isFinite(createdAtMs) && createdAtMs > 0)
      ? createdAtMs
      : Date.now();

    const newRating = Object.freeze({
      deviceId: deviceId.trim(),
      stars,
      comment: typeof comment === 'string' ? comment.trim() : '',
      createdAtMs: resolvedCreatedAtMs,
    });

    const existingRatings = Array.isArray(session.ratings) ? session.ratings : [];
    const existingIndex = existingRatings.findIndex((r) => r.deviceId === newRating.deviceId);
    let updatedRatings;
    if (existingIndex >= 0) {
      // Idempotent update: replace existing rating from this device
      const cloned = [...existingRatings];
      cloned[existingIndex] = newRating;
      updatedRatings = Object.freeze(cloned);
    } else {
      updatedRatings = Object.freeze([...existingRatings, newRating]);
    }

    const sum = updatedRatings.reduce((acc, r) => acc + r.stars, 0);
    const averageRating = Number((sum / updatedRatings.length).toFixed(2));

    const updatedSession = Object.freeze({
      ...session,
      ratings: updatedRatings,
      averageRating,
    });

    return ok(updatedSession);
  }
}

export const transitionSession = SessionStateMachine.transition;
export const addRating = RatingCalculator.addRating;
