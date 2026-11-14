import type { SkillCategory } from '@prisma/client'

/**
 * Skill taxonomy used to seed the `skills` table and to power keyword
 * inference. Aliases are the only signal the inference engine reads, which keeps
 * every suggested skill explainable back to a phrase the candidate typed.
 */
export type TaxonomySkill = {
  name: string
  slug: string
  category: SkillCategory
  transferable: boolean
  description: string
  aliases: string[]
  relatedSlugs: string[]
}

const skill = (
  name: string,
  category: SkillCategory,
  description: string,
  aliases: string[],
  options: { transferable?: boolean; related?: string[] } = {},
): TaxonomySkill => ({
  name,
  slug: name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, ''),
  category,
  transferable: options.transferable ?? true,
  description,
  aliases,
  relatedSlugs: options.related ?? [],
})

export const SKILL_TAXONOMY: TaxonomySkill[] = [
  // ---------------------------------------------------------------- ANALYTICAL
  skill(
    'Data Analysis',
    'ANALYTICAL',
    'Collecting, cleaning and interpreting data to answer a question or support a decision.',
    ['data analysis', 'analyze data', 'analysed data', 'interpret data', 'data interpretation', 'sql', 'spreadsheet analysis', 'trend analysis'],
    { related: ['excel', 'reporting', 'attention-to-detail'] },
  ),
  skill(
    'Reporting',
    'ANALYTICAL',
    'Turning raw numbers into regular, readable updates for stakeholders.',
    ['reporting', 'reports', 'monthly report', 'management report', 'dashboard', 'kpi reporting', 'mi reports'],
    { related: ['data-analysis', 'excel', 'stakeholder-management'] },
  ),
  skill(
    'Excel',
    'ANALYTICAL',
    'Spreadsheet modelling, formulas, pivots and lookups.',
    ['excel', 'spreadsheet', 'pivot table', 'vlookup', 'xlookup', 'formulas', 'google sheets'],
    { related: ['data-analysis', 'reporting'] },
  ),
  skill(
    'Research',
    'ANALYTICAL',
    'Structured information gathering from multiple sources.',
    ['research', 'desk research', 'primary research', 'secondary research', 'survey design', 'market research'],
    { related: ['data-analysis', 'writing'] },
  ),
  skill(
    'Financial Literacy',
    'ANALYTICAL',
    'Budgets, reconciliation, invoices and cost tracking.',
    ['budget', 'budgeting', 'reconciliation', 'invoicing', 'accounts', 'cost tracking', 'forecasting', 'p&l', 'profit and loss', 'bookkeeping'],
    { transferable: true, related: ['excel', 'reporting'] },
  ),
  skill(
    'Problem Solving',
    'ANALYTICAL',
    'Diagnosing a root cause and choosing a workable fix.',
    ['problem solving', 'troubleshoot', 'root cause', 'debugging', 'resolved issues', 'find solutions', 'difficult problems'],
    { related: ['critical-thinking', 'decision-making'] },
  ),
  skill(
    'Critical Thinking',
    'ANALYTICAL',
    'Weighing evidence before accepting a conclusion.',
    ['critical thinking', 'evaluate options', 'assess risk', 'due diligence', 'question assumptions'],
    { related: ['problem-solving', 'decision-making'] },
  ),
  skill(
    'Attention to Detail',
    'ANALYTICAL',
    'Producing accurate, error-free work and catching mistakes early.',
    ['attention to detail', 'accuracy', 'error free', 'proofread', 'quality check', 'fact check', 'data entry accuracy'],
    { related: ['quality-assurance', 'records-management'] },
  ),

  // ---------------------------------------------------------------- COMMUNICATION
  skill(
    'Written Communication',
    'COMMUNICATION',
    'Clear emails, documents and audience-appropriate writing.',
    ['written communication', 'email', 'documentation', 'drafted letters', 'reports writing', 'content writing', 'copywriting', 'notes to parents'],
    { related: ['stakeholder-management', 'presentation-skills'] },
  ),
  skill(
    'Verbal Communication',
    'COMMUNICATION',
    'Explaining, listening and updating people confidently.',
    ['verbal communication', 'presented', 'briefings', 'phone calls', 'explained to customers', 'spoke to families', 'meetings facilitation'],
    { related: ['customer-service', 'presentation-skills'] },
  ),
  skill(
    'Presentation Skills',
    'COMMUNICATION',
    'Structuring and delivering material to an audience.',
    ['presentation', 'presentations', 'deck', 'public speaking', 'town hall', 'demo day'],
    { related: ['verbal-communication', 'stakeholder-management'] },
  ),
  skill(
    'Stakeholder Management',
    'COMMUNICATION',
    'Keeping multiple interested parties aligned and informed.',
    ['stakeholder', 'managed expectations', 'client liaison', 'cross team', 'coordinated with', 'liaison'],
    { related: ['negotiation', 'project-coordination'] },
  ),
  skill(
    'Negotiation',
    'COMMUNICATION',
    'Reaching agreement where interests differ.',
    ['negotiat', 'bargain', 'agreed terms', 'dispute resolution', 'resolved conflict', 'persuaded'],
    { related: ['stakeholder-management', 'customer-service'] },
  ),
  skill(
    'Customer Service',
    'COMMUNICATION',
    'Handling enquiries and complaints to resolution.',
    ['customer service', 'customer support', 'client support', 'complaints', 'helpdesk', 'after sales', 'user queries', 'service recovery'],
    { related: ['empathy', 'problem-solving'] },
  ),
  skill(
    'Translation & Local Language',
    'COMMUNICATION',
    'Working across languages or localising content.',
    ['translation', 'translated', 'bilingual', 'localisation', 'interpreter', 'fluent in'],
    { related: ['written-communication'] },
  ),

  // ---------------------------------------------------------------- LEADERSHIP
  skill(
    'Team Leadership',
    'LEADERSHIP',
    'Setting direction and supporting a team to deliver.',
    ['team lead', 'led a team', 'managed a team', 'supervisor', 'headed', 'directed', 'reporting line', 'people management'],
    { related: ['mentoring', 'performance-management', 'project-coordination'] },
  ),
  skill(
    'Project Coordination',
    'LEADERSHIP',
    'Planning work, sequencing tasks and hitting dates.',
    ['project coordination', 'coordinated', 'project managed', 'timeline', 'milestones', 'deliver on time', 'planning', 'logistics'],
    { related: ['time-management', 'team-leadership', 'risk-management'] },
  ),
  skill(
    'Decision Making',
    'LEADERSHIP',
    'Choosing between options with incomplete information.',
    ['decision making', 'decided', 'approval', 'authorised', 'sign-off', 'chose between'],
    { related: ['critical-thinking', 'problem-solving'] },
  ),
  skill(
    'Mentoring',
    'LEADERSHIP',
    'Developing someone through structured guidance.',
    ['mentored', 'mentor', 'coached', 'trained new joiners', 'onboarding new staff', 'guided junior', 'buddy'],
    { related: ['team-leadership', 'teaching'] },
  ),
  skill(
    'Performance Management',
    'LEADERSHIP',
    'Setting objectives and reviewing progress with people.',
    ['appraisal', 'performance review', 'kpi setting', 'objective setting', 'okr', 'one to ones', 'feedback sessions'],
    { related: ['team-leadership', 'mentoring'] },
  ),
  skill(
    'Budget Ownership',
    'LEADERSHIP',
    'Accountable for spending against a plan.',
    ['owned budget', 'budget holder', 'spend approval', 'cost centre', 'purchasing authority'],
    { transferable: false, related: ['financial-literacy'] },
  ),
  skill(
    'Change Management',
    'LEADERSHIP',
    'Moving people and process to a new way of working.',
    ['change management', 'rollout', 'migration', 'transformation', 'process redesign', 'new system implementation'],
    { related: ['project-coordination', 'stakeholder-management'] },
  ),
  skill(
    'Risk Management',
    'LEADERSHIP',
    'Anticipating what could go wrong and reducing it.',
    ['risk assessment', 'mitigation', 'compliance risk', 'safeguarding', 'safety audit', 'hazard'],
    { related: ['critical-thinking', 'process-improvement'] },
  ),

  // ---------------------------------------------------------------- COLLABORATION
  skill(
    'Collaboration',
    'COLLABORATION',
    'Working effectively with peers across functions.',
    ['collaborated', 'worked with teams', 'cross functional', 'partnership', 'joint project', 'teamwork'],
    { related: ['stakeholder-management'] },
  ),
  skill(
    'Conflict Resolution',
    'COLLABORATION',
    'De-escalating disagreement and finding workable ground.',
    ['conflict resolution', 'mediated', 'defused', 'resolved disagreement', 'grievance'],
    { related: ['negotiation', 'empathy'] },
  ),
  skill(
    'Empathy',
    'COLLABORATION',
    'Understanding another person’s situation and responding appropriately.',
    ['empathy', 'understood their situation', 'supportive', 'listened to concerns', 'sensitive situation', 'counselling'],
    { related: ['customer-service', 'conflict-resolution'] },
  ),
  skill(
    'Scheduling & Coordination',
    'COLLABORATION',
    'Arranging people, appointments and resources without clashes.',
    ['scheduling', 'diary', 'calendar', 'appointment', 'roster', 'shift planning', 'booked travel', 'coordinated appointments'],
    { related: ['time-management', 'administrative-support'] },
  ),
  skill(
    'Records Management',
    'COLLABORATION',
    'Keeping confidential information accurate, filed and retrievable.',
    ['records', 'filing', 'file management', 'case notes', 'documentation kept', 'maintained records', 'confidential files', 'data protection'],
    { related: ['attention-to-detail', 'administrative-support'] },
  ),
  skill(
    'Administrative Support',
    'OPERATIONAL',
    'Keeping an office or service running through organised admin.',
    ['administration', 'admin', 'front desk', 'reception', 'clerical', 'office management', 'minutes'],
    { related: ['scheduling-coordination', 'records-management'] },
  ),

  // ---------------------------------------------------------------- OPERATIONAL
  skill(
    'Time Management',
    'OPERATIONAL',
    'Prioritising competing demands and meeting deadlines.',
    ['time management', 'prioritised', 'deadlines', 'multitask', 'juggled', 'tight schedule', 'met deadlines'],
    { related: ['project-coordination', 'working-under-pressure'] },
  ),
  skill(
    'Working Under Pressure',
    'OPERATIONAL',
    'Staying effective when stakes and volume rise.',
    ['under pressure', 'urgent', 'crisis', 'high volume', 'peak season', 'emergency response', 'demanding deadlines'],
    { related: ['resilience', 'time-management'] },
  ),
  skill(
    'Process Improvement',
    'OPERATIONAL',
    'Finding a better way to run a repeatable process.',
    ['process improvement', 'streamlined', 'automated', 'reduced turnaround', 'saved time', 'standard operating procedure', 'sla improvement', 'six sigma', 'lean'],
    { related: ['data-analysis', 'change-management'] },
  ),
  skill(
    'Quality Assurance',
    'OPERATIONAL',
    'Checking work against a standard before it ships.',
    ['quality assurance', 'qa', 'testing', 'inspection', 'audit', 'accuracy checks', 'review process'],
    { related: ['attention-to-detail', 'process-improvement'] },
  ),
  skill(
    'Vendor & Supplier Management',
    'OPERATIONAL',
    'Sourcing, comparing and managing external suppliers.',
    ['vendor', 'supplier', 'procurement', 'sourcing', 'tender', 'contract management', 'third party'],
    { related: ['negotiation', 'budget-ownership'] },
  ),
  skill(
    'Inventory & Resource Management',
    'OPERATIONAL',
    'Tracking stock, supplies or shared resources.',
    ['inventory', 'stock', 'supplies', 'resource planning', 'warehouse', 'materials planning'],
    { related: ['process-improvement', 'financial-literacy'] },
  ),
  skill(
    'Resilience',
    'OPERATIONAL',
    'Recovering from setbacks and sustaining effort.',
    ['resilience', 'persisted', 'kept going', 'adapting to setbacks', 'handled rejection', 'bounce back'],
    { related: ['working-under-pressure', 'learning-agility'] },
  ),
  skill(
    'Adaptability',
    'OPERATIONAL',
    'Adjusting quickly to new tools, teams or rules.',
    ['adapted', 'flexible', 'new environment', 'switched tools', 'quick to adjust', 'variety of roles'],
    { related: ['learning-agility', 'resilience'] },
  ),
  skill(
    'Resourcefulness',
    'OPERATIONAL',
    'Getting things done with what is available.',
    ['resourceful', 'improvised', 'found a way', 'limited budget', 'did more with less', 'workaround'],
    { related: ['problem-solving', 'adaptability'] },
  ),
  skill(
    'Reliability',
    'OPERATIONAL',
    'Consistently showing up and doing what was agreed.',
    ['reliable', 'dependable', 'consistent', 'never missed', 'on time', 'followed through'],
    { related: ['time-management', 'attention-to-detail'] },
  ),
  skill(
    'Multilingual Coordination',
    'OPERATIONAL',
    'Bridging language gaps in a service or team context.',
    ['language barrier', 'translated for', 'helped non speakers', 'multilingual'],
    { related: ['translation-local-language', 'empathy'] },
  ),

  // ---------------------------------------------------------------- DIGITAL
  skill(
    'CRM Software',
    'DIGITAL',
    'Working inside customer relationship systems.',
    ['salesforce', 'hubspot', 'zoho', 'crm', 'customer database', 'pipeline tool'],
    { transferable: false, related: ['data-analysis', 'customer-service'] },
  ),
  skill(
    'HR & Payroll Systems',
    'DIGITAL',
    'Operating applicant tracking, HRIS or payroll tools.',
    ['workday', 'bamboo', 'successfactors', 'hris', 'payroll software', 'applicant tracking', 'ats', 'zoho people', 'greytHR'],
    { transferable: false, related: ['recruitment', 'records-management'] },
  ),
  skill(
    'Collaboration Tools',
    'DIGITAL',
    'Working productively in shared document and chat platforms.',
    ['slack', 'teams', 'sharepoint', 'notion', 'confluence', 'google workspace', 'trello', 'asana', 'jira'],
    { related: ['collaboration', 'scheduling-coordination'] },
  ),
  skill(
    'Accounting Software',
    'DIGITAL',
    'Bookkeeping and accounts platforms.',
    ['tally', 'quickbooks', 'zoho books', 'sage', 'accounting software', 'gst filing'],
    { transferable: false, related: ['financial-literacy', 'bookkeeping' ] },
  ),
  skill(
    'Digital Literacy',
    'DIGITAL',
    'Confident, safe use of everyday business software.',
    ['computer literate', 'digital tools', 'online banking', 'email setup', 'document management', 'video conferencing'],
    { related: ['learning-agility', 'collaboration-tools'] },
  ),
  skill(
    'Content Creation',
    'CREATIVE',
    'Producing written, visual or video material for an audience.',
    ['content creation', 'blog', 'social media posts', 'canva', 'newsletter', 'wrote articles', 'video editing'],
    { related: ['written-communication', 'digital-literacy'] },
  ),
  skill(
    'Design Sense',
    'CREATIVE',
    'Producing tidy, on-brand visual material.',
    ['figma', 'photoshop', 'brand guidelines', 'layout', 'visual design', 'branding'],
    { transferable: false, related: ['content-creation'] },
  ),
  skill(
    'Teaching',
    'DOMAIN',
    'Planning and delivering learning to a group.',
    ['teaching', 'taught', 'tutoring', 'lesson planning', 'classroom', 'trainer', 'faculty'],
    { related: ['mentoring', 'presentation-skills'] },
  ),
  skill(
    'Learning Agility',
    'DIGITAL',
    'Acquiring new skills quickly and applying them.',
    ['self taught', 'learned quickly', 'upskilled', 'online course', 'certification', 'picked up fast', 'new skill'],
    { related: ['adaptability', 'digital-literacy'] },
  ),

  // ---------------------------------------------------------------- TECHNICAL
  skill(
    'Programming',
    'TECHNICAL',
    'Writing and maintaining code.',
    ['python', 'javascript', 'java', 'c++', 'typescript', 'coding', 'programmed', 'developed software', 'scripting'],
    { transferable: false, related: ['web-development', 'testing'] },
  ),
  skill(
    'Web Development',
    'TECHNICAL',
    'Building websites and web applications.',
    ['react', 'next js', 'html', 'css', 'wordpress', 'frontend', 'backend', 'api development', 'web developer'],
    { transferable: false, related: ['programming', 'testing'] },
  ),
  skill(
    'Database Management',
    'TECHNICAL',
    'Designing and querying data stores.',
    ['sql', 'mysql', 'postgres', 'mongodb', 'database design', 'queries', 'data modelling'],
    { transferable: false, related: ['data-analysis', 'programming'] },
  ),
  skill(
    'Software Testing',
    'TECHNICAL',
    'Verifying software behaviour and documenting defects.',
    ['testing', 'test cases', 'qa testing', 'test automation', 'selenium', 'bug reporting', 'regression'],
    { transferable: false, related: ['quality-assurance', 'programming'] },
  ),
  skill(
    'Cloud & IT Support',
    'TECHNICAL',
    'Administering infrastructure or supporting users technically.',
    ['aws', 'azure', 'gcp', 'server admin', 'network support', 'it support', 'troubleshooting hardware', 'linux'],
    { transferable: false, related: ['digital-literacy', 'problem-solving'] },
  ),
  skill(
    'Data Privacy & Security',
    'TECHNICAL',
    'Handling personal data lawfully and securely.',
    ['gdpr', 'data protection', 'confidentiality', 'privacy policy', 'information security', 'hipaa', 'dpdp'],
    { related: ['records-management', 'risk-management'] },
  ),
  skill(
    'Automation',
    'TECHNICAL',
    'Removing manual steps with scripts or workflow tools.',
    ['automated', 'macro', 'zapier', 'power automate', 'rpa', 'workflow automation', 'batch process'],
    { transferable: false, related: ['process-improvement', 'programming'] },
  ),

  // ---------------------------------------------------------------- DOMAIN
  skill(
    'Recruitment',
    'DOMAIN',
    'Sourcing, screening and onboarding people.',
    ['recruitment', 'talent acquisition', 'hiring', 'screening resumes', 'interviewing candidates', 'sourcing', 'onboarding'],
    { related: ['hr-policy-compliance', 'stakeholder-management'] },
  ),
  skill(
    'HR Policy & Compliance',
    'DOMAIN',
    'Applying employment policy and statutory rules.',
    ['hr policy', 'labour law', 'statutory compliance', 'employee relations', 'disciplinary', 'police verification', 'pf', 'esi'],
    { related: ['recruitment', 'data-privacy-security'] },
  ),
  skill(
    'Bookkeeping',
    'DOMAIN',
    'Maintaining accurate day-to-day financial records.',
    ['bookkeeping', 'ledger', 'accounts payable', 'accounts receivable', 'bank reconciliation', 'expense reports'],
    { transferable: false, related: ['financial-literacy', 'accounting-software'] },
  ),
  skill(
    'Healthcare Coordination',
    'DOMAIN',
    'Managing care routines, medication and clinical information.',
    ['patient coordination', 'care plan', 'medication schedule', 'clinic', 'hospital admin', 'health records', 'caregiver coordination', 'appointments with doctors'],
    { related: ['scheduling-coordination', 'records-management', 'empathy'] },
  ),
  skill(
    'Education Administration',
    'DOMAIN',
    'Running the operational side of a school or programme.',
    ['school admin', 'admissions', 'exam scheduling', 'parent teacher meeting', 'attendance tracking', 'academic records'],
    { related: ['teaching', 'administrative-support', 'scheduling-coordination'] },
  ),
  skill(
    'Community Mobilisation',
    'DOMAIN',
    'Organising people around a shared local cause.',
    ['community work', 'volunteered', 'ngo', 'awareness drive', 'mobilised', 'self help group', 'fundraiser', 'residents association'],
    { related: ['stakeholder-management', 'collaboration'] },
  ),
  skill(
    'Event Management',
    'DOMAIN',
    'Planning and running events end to end.',
    ['event management', 'organized an event', 'venue', 'logistics for event', 'conference', 'webinar hosting'],
    { related: ['project-coordination', 'vendor-supplier-management'] },
  ),
  skill(
    'Sales & Business Development',
    'DOMAIN',
    'Generating and converting commercial opportunities.',
    ['sales', 'business development', 'lead generation', 'closing', 'quota', 'pipeline', 'client acquisition', 'cold calling'],
    { transferable: false, related: ['negotiation', 'customer-service'] },
  ),
  skill(
    'Marketing Fundamentals',
    'DOMAIN',
    'Planning and running campaigns and positioning.',
    ['marketing', 'campaign', 'seo', 'brand strategy', 'market segmentation', 'advertising', 'funnel'],
    { transferable: false, related: ['content-creation', 'data-analysis'] },
  ),
  skill(
    'Child Development Knowledge',
    'DOMAIN',
    'Practical understanding of child learning and wellbeing.',
    ['child development', 'parenting', 'childcare', 'school readiness', 'special needs support', 'learning difficulty', 'bedtime routine'],
    { related: ['teaching', 'empathy', 'scheduling-coordination'] },
  ),
  skill(
    'Elder Care Coordination',
    'DOMAIN',
    'Organising ongoing care for older family members.',
    ['elder care', 'caring for parents', 'caregiver for elderly', 'assisted living', 'mobility support', 'medical appointments'],
    { related: ['healthcare-coordination', 'records-management', 'resilience'] },
  ),
  skill(
    'Household Financial Management',
    'DOMAIN',
    'Running a multi-person budget, bills and insurance.',
    ['household budget', 'managing expenses', 'insurance', 'school fees planning', 'bill payments', 'loan planning', 'emergedgency fund'],
    { related: ['financial-literacy', 'planning'] },
  ),
  skill(
    'Planning & Foresight',
    'DOMAIN',
    'Sequencing future needs and preparing for them.',
    ['planned ahead', 'contingency', 'long term planning', 'prepared for', 'forecast needs', 'organized in advance'],
    { related: ['project-coordination', 'risk-management'] },
  ),
  skill(
    'Caregiving Coordination',
    'DOMAIN',
    'Running the logistics of care for a household: appointments, medications, specialists, helpers and records.',
    ['care coordination', 'caregiving', 'managed care', 'looked after', 'cared for', 'homemaker', 'raising children', 'family support'],
    { related: ['healthcare-coordination', 'scheduling-coordination', 'records-management', 'multitasking'] },
  ),
  skill(
    'Multitasking',
    'OPERATIONAL',
    'Holding several parallel responsibilities without dropping them.',
    ['multitasking', 'handled multiple', 'parallel', 'juggled responsibilities', 'simultaneous'],
    { related: ['time-management', 'working-under-pressure'] },
  ),
  skill(
    'Remote Work',
    'DIGITAL',
    'Working asynchronously and visibly distributed.',
    ['remote', 'work from home', 'distributed team', 'asynchronous', 'time zones', 'hybrid'],
    { related: ['collaboration-tools', 'digital-literacy'] },
  ),
  skill(
    'Fundraising & Grant Writing',
    'DOMAIN',
    'Securing money through proposals and donor relationships.',
    ['fundraising', 'grant proposal', 'donor', 'sponsorship', 'crowdfunding', 'wrote a proposal'],
    { related: ['written-communication', 'stakeholder-management'] },
  ),
]

/**
 * Structured caregiving / break activities offered during onboarding. Each one
 * names the competencies it exercises and the evidence sentence written into
 * `skill_evidence`, so a transferable skill always carries a traceable reason.
 */
export type CaregivingActivity = {
  key: string
  label: string
  prompt: string
  skillSlugs: string[]
  evidence: string
}

export const CAREGIVING_ACTIVITIES: CaregivingActivity[] = [
  {
    key: 'medical_logistics',
    label: 'Medical appointments and medication routines',
    prompt: 'Did you book appointments, manage medications or coordinate with doctors?',
    skillSlugs: ['healthcare-coordination', 'scheduling-coordination', 'records-management', 'attention-to-detail'],
    evidence: 'Managed medical appointments, medication schedules and clinician communication for a household member.',
  },
  {
    key: 'household_budget',
    label: 'Household budget and bills',
    prompt: 'Were you responsible for the household budget, fees, insurance or bill payments?',
    skillSlugs: ['household-financial-management', 'financial-literacy', 'planning-foresight'],
    evidence: 'Owned a recurring multi-line household budget including bills, insurance and education fees.',
  },
  {
    key: 'child_learning',
    label: 'Children’s learning and development',
    prompt: 'Did you support a child’s schooling, learning routines or special needs?',
    skillSlugs: ['child-development-knowledge', 'teaching', 'records-management', 'planning-foresight'],
    evidence: 'Planned and tracked learning routines, school coordination and developmental support over an extended period.',
  },
  {
    key: 'care_team',
    label: 'Coordinating helpers, carers and family',
    prompt: 'Did you coordinate help — carers, domestic support, relatives, specialists?',
    skillSlugs: ['caregiving-coordination', 'stakeholder-management', 'scheduling-coordination', 'conflict-resolution'],
    evidence: 'Coordinated a rotating group of carers, family members and specialists around one care plan.',
  },
  {
    key: 'relocation',
    label: 'Relocation or settling a new city',
    prompt: 'Did you move city or country and set up systems from scratch?',
    skillSlugs: ['adaptability', 'planning-foresight', 'administrative-support', 'resourcefulness'],
    evidence: 'Planned and executed a relocation, standing up housing, documentation and service arrangements independently.',
  },
  {
    key: 'volunteering',
    label: 'Volunteering or community work',
    prompt: 'Did you volunteer, run community activity or work with an NGO or group?',
    skillSlugs: ['community-mobilisation', 'event-management', 'collaboration', 'fundraising-grant-writing'],
    evidence: 'Contributed sustained volunteering or community organising with responsibility for an outcome.',
  },
  {
    key: 'freelance_small',
    label: 'Freelance, side work or a small business',
    prompt: 'Did you do any freelance work, tuition, selling or small business during the break?',
    skillSlugs: ['sales-business-development', 'financial-literacy', 'customer-service', 'resourcefulness'],
    evidence: 'Delivered paid freelance or small-business work with direct customer and financial responsibility.',
  },
  {
    key: 'upskilling',
    label: 'Courses or self-directed study',
    prompt: 'Did you take courses, certifications or teach yourself something new?',
    skillSlugs: ['learning-agility', 'digital-literacy', 'time-management'],
    evidence: 'Completed structured self-directed study while managing caring responsibilities.',
  },
]

export const TAXONOMY_BY_SLUG = new Map(SKILL_TAXONOMY.map((entry) => [entry.slug, entry]))

export function taxonomySlugs() {
  return SKILL_TAXONOMY.map((entry) => entry.slug)
}
