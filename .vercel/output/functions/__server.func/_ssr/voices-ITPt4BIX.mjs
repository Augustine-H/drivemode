//#region node_modules/.nitro/vite/services/ssr/assets/voices-ITPt4BIX.js
var VOICE_OPTIONS = [
	{
		id: "leo",
		name: "레오",
		gender: "male"
	},
	{
		id: "rex",
		name: "렉스",
		gender: "male"
	},
	{
		id: "sal",
		name: "살",
		gender: "male"
	},
	{
		id: "gork",
		name: "고크",
		gender: "male"
	},
	{
		id: "altair",
		name: "알타이르",
		gender: "male"
	},
	{
		id: "atlas",
		name: "아틀라스",
		gender: "male"
	},
	{
		id: "castor",
		name: "카스토르",
		gender: "male"
	},
	{
		id: "cosmo",
		name: "코스모",
		gender: "male"
	},
	{
		id: "helios",
		name: "헬리오스",
		gender: "male"
	},
	{
		id: "helix",
		name: "헬릭스",
		gender: "male"
	},
	{
		id: "kepler",
		name: "케플러",
		gender: "male"
	},
	{
		id: "lumen",
		name: "루멘",
		gender: "male"
	},
	{
		id: "lux",
		name: "럭스",
		gender: "male"
	},
	{
		id: "naksh",
		name: "낙슈",
		gender: "male"
	},
	{
		id: "orion",
		name: "오리온",
		gender: "male"
	},
	{
		id: "perseus",
		name: "페르세우스",
		gender: "male"
	},
	{
		id: "rigel",
		name: "리겔",
		gender: "male"
	},
	{
		id: "sirius",
		name: "시리우스",
		gender: "male"
	},
	{
		id: "zagan",
		name: "자간",
		gender: "male"
	},
	{
		id: "zenith",
		name: "제니스",
		gender: "male"
	},
	{
		id: "ara",
		name: "아라",
		gender: "female"
	},
	{
		id: "eve",
		name: "이브",
		gender: "female"
	},
	{
		id: "luna",
		name: "루나",
		gender: "female"
	},
	{
		id: "aurora",
		name: "오로라",
		gender: "female"
	},
	{
		id: "carina",
		name: "카리나",
		gender: "female"
	},
	{
		id: "celeste",
		name: "셀레스트",
		gender: "female"
	},
	{
		id: "iris",
		name: "아이리스",
		gender: "female"
	},
	{
		id: "liora",
		name: "리오라",
		gender: "female"
	},
	{
		id: "ursa",
		name: "우르사",
		gender: "female"
	},
	{
		id: "device",
		name: "휴대폰 음성",
		gender: "device"
	}
];
new Set(VOICE_OPTIONS.map((v) => v.id));
var MALE_VOICES = VOICE_OPTIONS.filter((v) => v.gender === "male" || v.gender === "device");
var FEMALE_VOICES = VOICE_OPTIONS.filter((v) => v.gender === "female");
function isMaleVoice(id) {
	return MALE_VOICES.some((v) => v.id === id);
}
function isFemaleVoice(id) {
	return FEMALE_VOICES.some((v) => v.id === id);
}
var API_VOICES = new Set(VOICE_OPTIONS.filter((v) => v.id !== "device").map((v) => v.id));
//#endregion
export { isMaleVoice as a, isFemaleVoice as i, FEMALE_VOICES as n, MALE_VOICES as r, API_VOICES as t };
