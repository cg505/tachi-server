import { integer } from "tachi-common";

export interface BeatorajaContext {
	client: "lr2oraja";
	chart: BeatorajaChart;
	userID: integer; // unexpectedly necessary for orphan code!
}

export interface BeatorajaChart {
	md5: string;
	sha256: string;
	title: string;
	subtitle: string;
	genre: string;
	artist: string;
	subartist: string;
	total: integer;

	mode: "BEAT_7K" | "BEAT_14K";
	judge: number;
	notes: integer;
	hasRandom: boolean;
	hasUndefinedLN: boolean;
}

export interface BeatorajaScore {
	sha256: string;
	exscore: integer;
	passnotes: integer;
	gauge: number;
	deviceType: "BM_CONTROLLER" | "KEYBOARD";
	minbp: integer;
	option: 0 | 1 | 2 | 3 | 4;

	lntype: 0 | 1;
	clear:
		| "NoPlay"
		| "Failed"
		| "LightAssistEasy"
		| "Easy"
		| "Normal"
		| "Hard"
		| "ExHard"
		| "FullCombo"
		| "Perfect";
	assist: 0;
	maxcombo: integer;

	epg: integer;
	egr: integer;
	egd: integer;
	ebd: integer;
	epr: integer;
	lpg: integer;
	lgr: integer;
	lgd: integer;
	lbd: integer;
	lpr: integer;
	ems: integer;
	lms: integer;
}
