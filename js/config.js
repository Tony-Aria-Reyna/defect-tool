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
  name: 'Resero Defects',
  version: '2.44.2',
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
export const ROLES = { admin: 'Admin', editor: 'Editor', contractor: 'Contractor', viewer: 'Viewer' };
export const ROLE_HELP = {
  admin: 'Sets up the project, plans, rooms and users. Can do everything.',
  editor: 'Raises, edits and closes defects.',
  contractor: 'Sees the register, adds photos and comments, marks items In progress or Ready for review. Cannot close or delete.',
  viewer: 'Read only, can export.',
};
