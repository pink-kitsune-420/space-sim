import { captureDocument, type ManualGuide } from '../../packages/game-api/src/index';
import source from './assets/manual.json';

/** Game-owned inert guide data, registered through the existing optional Manual service. */
export const surveyGuide: ManualGuide = Object.freeze({
 id: 'builtin.survey-fixture/survey', audience: 'players', title: source.title,
 summary: source.summary, document: captureDocument(source),
});
