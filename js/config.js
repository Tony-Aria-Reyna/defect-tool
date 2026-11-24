// Firebase web config. This is public by design: access is controlled by firestore.rules and storage.rules.
export const firebaseConfig = {
  apiKey: "AIzaSyC90m5Wetwm6o9YfYuR6An7Sx-yDmatRoQ",
  authDomain: "resero-site-tools.firebaseapp.com",
  projectId: "resero-site-tools",
  storageBucket: "resero-site-tools.firebasestorage.app",
  messagingSenderId: "730700765221",
  appId: "1:730700765221:web:9bc2b26907e9f5c63e47cc"
};

export const APP = {
  name: 'Resero Site',
  version: '3.8.3',
  company: 'Resero Property',
};

// Defaults used when a new project is created (each project can change them in Project settings).
export const DEFAULTS = {
  statuses: ['Open', 'In progress', 'Ready for review', 'Closed', 'Disputed'],
  severities: ['To triage', 'Major - prevents PC', 'Minor defect', 'Minor omission', 'Documentation', 'Observation only'],
  types: ['Workmanship / rework', 'Damage', 'Incomplete / omission', 'Non-compliance', 'Design review', 'Documentation', 'Cleaning', 'Other'],
  trades: ['General / builder', 'Structure', 'Cladding & envelope', 'Brick veneer', 'Roofing & rainwater', 'Windows & glazing', 'Doors & hardware', 'Linings & ceilings', 'Painting & finishes', 'Floor coverings', 'Joinery & kitchens', 'Plumbing & drainage', 'Electrical', 'Mechanical & ventilation', 'Fire protection', 'Lift', 'Balustrades & stairs', 'Appliances', 'External works', 'Landscaping', 'Signage', 'Cleaning'],
  sources: ['PC walk-through', 'Engineer to the Contract', 'Client', 'Consultant inspection', 'Tenant / occupier (DNP)', 'Other'],
  responsible: ['Main contractor', 'Client', 'Design team', 'Engineer to the Contract', 'Other'],
  rooms: ['Living', 'Kitchen', 'Bathroom', 'Ensuite', 'Bedroom 1', 'Bedroom 2', 'Laundry', 'Entry', 'Deck / patio', 'Corridor', 'Stairwell', 'Lift lobby', 'Plant room', 'Carpark', 'Landscaping', 'Roof'],
};

export const STATUS_COLOURS = { 'Open': '#d64545', 'In progress': '#e39b1b', 'Ready for review': '#2f78c4', 'Closed': '#2e9b5f', 'Disputed': '#7d4fc4' };
export const ROLES = { admin: 'Admin', editor: 'Editor', inspector: 'Inspector', contractor: 'Contractor', client: 'Client', viewer: 'Viewer' };
export const ROLE_HELP = {
  admin: 'Sets up the project, plans, rooms and users. Can do everything.',
  editor: 'Raises, edits and closes defects.',
  contractor: 'Sees the register, adds photos and comments, marks items In progress or Ready for review, disputes items with a reason, and uploads warranties and handover documents. Cannot close or delete.',
  inspector: 'For a consultant or inspector (for example the architect\'s observer). Raises items in its own register, comments, and accepts or reopens items once they are marked ready. Cannot rewrite other people\'s items or delete anything.',
  client: 'For the building owner\'s team (property, facilities and village managers). Sees what is due, raises and follows up its own items such as residents\' issues, comments and adds photos on any item, marks maintenance done, records Form 12A certificates and uploads service reports. Cannot change or close other people\'s items.',
  viewer: 'Read only, can export.',
};
