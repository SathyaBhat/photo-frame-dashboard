// Mock data for the prototype. Everything is relative to "today" so the demo always looks current.
window.DATA = (function () {
  var base = new Date();
  base.setHours(0, 0, 0, 0);

  var n = 0;
  var ALL = ['sat', 'jo'];

  // Names and colours live here; home/away and the zone name come from Home Assistant (live.js).
  var people = [
    { id: 'sat', name: 'Sat', ha: 'person.sathyabhat', color: '#2D5BFF', rgb: '45 91 255', ink: '#FFFFFF', home: false, status: '' },
    { id: 'jo', name: 'Jo', ha: 'person.jo', color: '#E4007C', rgb: '228 0 124', ink: '#FFFFFF', home: false, status: '' }
  ];
  var family = { id: 'family', name: 'Family', color: '#111111', rgb: '17 17 17', ink: '#FFFFFF' };

  // ---------------------------------------------------------------- calendar
  // Filled from the shared Google Calendar by live.js.
  var events = [];
  var busyExtras = [];

  // ---------------------------------------------------------------- chores
  var routines = [
    { id: 'morning', name: 'Morning', range: '6 – 11 AM', from: 0, to: 11 },
    { id: 'after', name: 'After school', range: '11 AM – 5 PM', from: 11, to: 17 },
    { id: 'evening', name: 'Evening', range: '5 – 10 PM', from: 17, to: 24 }
  ];
  // No chore source yet: the Tasks view shows empty lanes.
  var chores = [];
  var stars = {};
  var week = {};

  // ---------------------------------------------------------------- shopping
  // The list, stores and usuals come from the Trello board (live.js). The catalog only feeds the add-item guesses.
  var stores = [];
  var catOrder = { all: [] };
  var gid = 0;
  var groceries = [];
  var catalog = [
    ['Apples', 'Produce'], ['Avocados', 'Produce'], ['Bananas', 'Produce'], ['Baby spinach', 'Produce'], ['Blueberries', 'Produce'],
    ['Broccoli', 'Produce'], ['Carrots', 'Produce'], ['Cucumber', 'Produce'], ['Garlic', 'Produce'], ['Grapes', 'Produce'],
    ['Lemons', 'Produce'], ['Limes', 'Produce'], ['Onions', 'Produce'], ['Potatoes', 'Produce'], ['Strawberries', 'Produce'],
    ['Tomatoes', 'Produce'], ['Bread', 'Bakery'], ['Bagels', 'Bakery'], ['Croissants', 'Bakery'], ['Sourdough loaf', 'Bakery'],
    ['Tortillas', 'Bakery'], ['Hamburger buns', 'Bakery'], ['Bacon', 'Meat & Fish'], ['Chicken breasts', 'Meat & Fish'],
    ['Chicken thighs', 'Meat & Fish'], ['Ground beef', 'Meat & Fish'], ['Salmon fillets', 'Meat & Fish'], ['Shrimp', 'Meat & Fish'],
    ['Butter', 'Dairy & Eggs'], ['Cheddar', 'Dairy & Eggs'], ['Cream cheese', 'Dairy & Eggs'], ['Eggs', 'Dairy & Eggs'],
    ['Greek yogurt', 'Dairy & Eggs'], ['Milk 2%', 'Dairy & Eggs'], ['Oat milk', 'Dairy & Eggs'], ['Parmesan', 'Dairy & Eggs'],
    ['Black beans', 'Pantry'], ['Cereal', 'Pantry'], ['Coffee beans', 'Pantry'], ['Flour', 'Pantry'], ['Honey', 'Pantry'],
    ['Maple syrup', 'Pantry'], ['Olive oil', 'Pantry'], ['Pasta sauce', 'Pantry'], ['Peanut butter', 'Pantry'], ['Rice', 'Pantry'],
    ['Rigatoni', 'Pantry'], ['Spaghetti', 'Pantry'], ['Sugar', 'Pantry'], ['Tea', 'Pantry'], ['Frozen peas', 'Frozen'],
    ['Frozen berries', 'Frozen'], ['Ice cream', 'Frozen'], ['Pizza', 'Frozen'], ['Waffles', 'Frozen'], ['Chips', 'Snacks'],
    ['Crackers', 'Snacks'], ['Dark chocolate', 'Snacks'], ['Goldfish crackers', 'Snacks'], ['Granola bars', 'Snacks'],
    ['Popcorn', 'Snacks'], ['Dish soap', 'Household'], ['Dishwasher pods', 'Household'], ['Garbage bags', 'Household'],
    ['Laundry detergent', 'Household'], ['Paper towels', 'Household'], ['Toilet paper', 'Household'], ['Toothpaste', 'Household']
  ];
  var usuals = [];

  // ---------------------------------------------------------------- home control
  // Filled from Home Assistant by live.js.
  var rooms = [];
  var devices = [];
  var climate = null;
  var battery = null;
  var media = null;
  var cameras = [];
  var scenes = [];

  // ---------------------------------------------------------------- weather (index = hour of day)
  var weather = {
    hi: 17, lo: 8, feels: -2, humidity: 71, wind: 18,
    t: [9, 9, 8, 8, 8, 8, 9, 10, 11, 12, 13, 15, 16, 17, 16, 15, 14, 13, 12, 12, 11, 10, 10, 9],
    c: ['moon', 'moon', 'moon', 'moon', 'moon', 'moon', 'partly', 'partly', 'sun', 'sun', 'sun', 'partly', 'partly', 'cloud', 'cloud', 'cloud', 'rain', 'rain', 'rain', 'rain', 'cloud', 'cloud', 'moon', 'moon'],
    p: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 5, 10, 20, 25, 40, 80, 90, 70, 55, 20, 10, 0, 0]
  };

  // ---------------------------------------------------------------- photos
  var t = new Date(base);
  var mmdd = ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2);
  var photos = [
    { seed: 'tofino-surf', o: 'l', date: '2021-' + mmdd, place: 'Tofino, BC', from: 'jo', tag: 'tofino' },
    { seed: 'cottage-dock', o: 'l', date: '2023-08-12', place: 'Lake of Bays', from: 'sat', tag: 'cottage' },
    { seed: 'maya-kite', o: 'p', date: '2024-05-19', place: 'Humber Bay Park', from: 'jo', tag: 'spring24' },
    { seed: 'otto-kite', o: 'p', date: '2024-05-19', place: 'Humber Bay Park', from: 'sat', tag: 'spring24' },
    { seed: 'autumn-walk', o: 'l', date: '2022-10-09', place: 'High Park', from: 'sat', tag: 'fall22' },
    { seed: 'birthday-cake', o: 'p', date: '2025-10-12', place: 'Home', from: 'jo', tag: 'bday25' },
    { seed: 'candles-lit', o: 'p', date: '2025-10-12', place: 'Home', from: 'sat', tag: 'bday25' },
    { seed: 'mountain-lake', o: 'l', date: '2019-' + mmdd, place: 'Banff, AB', from: 'sat', tag: 'banff' },
    { seed: 'snow-day', o: 'l', date: '2024-01-21', place: 'Riverdale Hill', from: 'jo', tag: 'winter24' },
    { seed: 'beach-dunes', o: 'l', date: '2023-07-02', place: 'Sandbanks', from: 'jo', tag: 'sandbanks' },
    { seed: 'city-night', o: 'l', date: '2022-12-18', place: 'Nathan Phillips Sq.', from: 'jo', tag: 'xmas22' },
    { seed: 'garden-bloom', o: 'p', date: '2025-06-08', place: 'Backyard', from: 'sat', tag: 'garden' },
    { seed: 'tomato-haul', o: 'p', date: '2025-06-08', place: 'Backyard', from: 'jo', tag: 'garden' },
    { seed: 'road-trip', o: 'l', date: '2024-08-04', place: 'Cabot Trail, NS', from: 'sat', tag: 'ns' },
    { seed: 'campfire', o: 'l', date: '2024-08-06', place: 'Cape Breton', from: 'jo', tag: 'ns' },
    { seed: 'forest-path', o: 'l', date: '2020-09-26', place: 'Algonquin', from: 'sat', tag: 'algonquin' },
    { seed: 'pancakes', o: 'p', date: '2026-03-14', place: 'Home', from: 'jo', tag: 'pancakes' },
    { seed: 'sugar-shack', o: 'p', date: '2026-03-14', place: 'Sugar Shack', from: 'jo', tag: 'pancakes' },
    { seed: 'harbour-sail', o: 'l', date: '2025-07-19', place: 'Toronto Harbour', from: 'sat', tag: 'sail' },
    { seed: 'pumpkins', o: 'l', date: '2025-10-25', place: "Chudleigh's", from: 'jo', tag: 'fall25' }
  ];

  return {
    people: people, family: family, ALL: ALL,
    events: events, busyExtras: busyExtras,
    routines: routines, chores: chores, stars: stars, week: week,
    stores: stores, catOrder: catOrder, groceries: groceries, catalog: catalog, usuals: usuals,
    rooms: rooms, devices: devices, climate: climate, battery: battery, media: media, cameras: cameras, scenes: scenes,
    weather: weather, photos: photos,
    _gid: function () { return 'g' + (++gid); },
    _eid: function () { return 'e' + (++n); }
  };
})();
