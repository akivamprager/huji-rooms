// The campuses the app covers. code = the Shnaton's campus code (room.building.campus.code).
// center: for picking the campus you're standing in. bbox: south, west, north, east (its corner is
// the origin of the path file's coordinates). mapPaths / mapBuildings: see tools/paths.mjs.
const ARC = 'https://services1.arcgis.com/mPH9o04hKi8EZj1o/arcgis/rest/services';
export const CAMPUSES = [
  {
    id: 'gr', code: '1', name: 'גבעת רם', center: [31.7762, 35.1975], bbox: [31.7680, 35.1915, 31.7810, 35.2030],
    // the university's own campus map (https://experience.arcgis.com/experience/20ad3eaec52143d6a73ecdac63390310):
    // its paths ("שביל", "שביל עץ") and roads are the walking network — never lawns or hedges;
    // building outlines by number
    mapPaths: [
      { url: `${ARC}/GivatRam_/FeatureServer/4` },
      { url: `${ARC}/%D7%93%D7%A8%D7%9B%D7%99%D7%9D/FeatureServer/0` }, // paths and campus roads (walkable)
    ],
    mapBuildings: { url: `${ARC}/GivatRam_/FeatureServer/3`, numberField: 'Text', fields: 'Text' },
  },
  {
    id: 'scopus', code: '0', name: 'הר הצופים', center: [31.7930, 35.2440], bbox: [31.7870, 35.2370, 31.7990, 35.2510],
    // https://experience.arcgis.com/experience/10504f10215441c4866e47d03a962e02: trails, accessible
    // trails, pedestrian paths and roads
    mapPaths: [
      { url: `${ARC}/Mt_Scopus_Map/FeatureServer/10` },
      { url: `${ARC}/Mt_Scopus_Map/FeatureServer/3` },
      { url: `${ARC}/%D7%93%D7%A8%D7%9B%D7%99%D7%9D_%D7%94%D7%A8_%D7%94%D7%A6%D7%95%D7%A4%D7%99%D7%9D/FeatureServer/3` }, // pedestrian paths and roads
    ],
    mapBuildings: { url: `${ARC}/Buildings_new/FeatureServer/0`, numberField: 'Scopus_bld_numbers_csv_number_b', fields: 'Scopus_bld_numbers_csv_number_b' },
  },
];
export const DEFAULT_CAMPUS = 'gr';
export const campusById = (id) => CAMPUSES.find((c) => c.id === id) || CAMPUSES[0];
