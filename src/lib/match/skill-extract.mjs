// A fixed technology vocabulary and the matcher that finds it in free text,
// with each alias folded onto one canonical name.
// MIT License, Copyright (c) 2026 Santiago Fernández de Valderrama.

export const SKILL_TOKENS = [
  'JavaScript', 'TypeScript', 'Python', 'Ruby', 'Java', 'Golang', 'Rust', 'PHP',
  'Kotlin', 'Swift', 'Scala', 'Elixir', 'C\\+\\+', 'C#', '\\.NET', 'SQL',
  'React Native', 'React', 'Angular', 'Vue\\.?js', 'Svelte', 'Next\\.?js',
  'Django', 'Flask', 'FastAPI', 'Rails', 'Laravel', 'Symfony', 'Spring',
  'Node\\.?js', 'NodeJS',
  'MongoDB', 'MySQL', 'PostgreSQL', 'Postgres', 'Redis', 'Elasticsearch',
  'Snowflake', 'BigQuery', 'Databricks', 'DynamoDB', 'Cassandra',
  'GraphQL', 'gRPC', 'Kafka', 'RabbitMQ',
  'AWS', 'GCP', 'Azure', 'Docker', 'Kubernetes', 'k8s', 'Terraform',
  'Ansible', 'Helm', 'Jenkins', 'GitHub Actions', 'GitLab CI', 'CI/CD',
  'Prometheus', 'Grafana', 'Datadog', 'Supabase', 'Inngest',
  'PyTorch', 'TensorFlow', 'scikit-learn', 'Pandas', 'NumPy', 'Spark',
  'Airflow', 'dbt', 'MLOps', 'MLflow', 'LangChain', 'LlamaIndex',
  'Hugging Face', 'RAG', 'LLMs?', 'Prompt Engineering', 'Fine-?tuning',
  'Computer Vision', 'NLP',
  'Tableau', 'Power BI', 'Looker', 'Salesforce', 'SAP',
  'PMI-ACP', 'PMI ACP', 'PgMP', 'CAPM', 'PMBOK', 'PMP',
  'PRINCE2', 'PRINCE 2',
  'Certified Scrum Product Owner', 'Certified ScrumMaster', 'Certified Scrum Master', 'CSPO',
  'ITIL', 'COBIT', 'TOGAF',
  'Lean Six Sigma', 'Lean Six-Sigma', 'Six Sigma', 'Six-Sigma',
  'CISSP', 'CISM', 'CIPP',
  'Account-Based Marketing', 'Account Based Marketing', 'ABM',
  'Demand-Side Platform', 'Demand Side Platform', 'DSPs', 'DSP',
  'Programmatic Advertising', 'Programmatic Display', 'Programmatic Media',
  'Programmatic Buying',
  'Media Agency Management', 'Media Agencies', 'Media Agency',
  'Demand Generation', 'Demand Gen',
  'Marketing Automation', 'Marketing Operations',
  'Revenue Operations', 'RevOps',
  'Lifecycle Marketing', 'Growth Marketing', 'Product Marketing',
  'Partner Marketing', 'Performance Marketing', 'Field Marketing',
  'Content Marketing', 'Email Marketing',
  'Paid Media', 'Paid Social', 'Paid Search',
  'Conversion Rate Optimization',
  'Marketing Mix Modeling', 'Media Mix Modeling', 'Incrementality',
  'Lead Scoring', 'Marketing Attribution',
  'SEMrush', 'SEO', 'SEM', 'PPC',
  'HubSpot', 'Marketo', 'Pardot', 'Braze', 'Klaviyo', 'OneSignal', 'Intercom',
  'Ahrefs', 'Demandbase', '6sense', 'Google Tag Manager', 'Google Analytics',
  'Google Ads', 'GA4', 'Amplitude', 'Mixpanel', 'n8n', 'Zapier',
];

const SAFE_CERT_PATTERN = /(?<!\w)SAFe(?!\w)/;

export const SKILL_PATTERN = new RegExp('(?<!\\w)(?:' + SKILL_TOKENS.join('|') + ')(?!\\w)', 'gi');

const GO_SKILL_PATTERN = /(?<!\w)Go(?![\w-])/;

export const DISPLAY = Object.fromEntries(SKILL_TOKENS.map(t => {
  const display = t.replace(/\\/g, '').replace(/\?/g, '');
  return [display.toLowerCase(), display];
}));

export const CANONICAL = {
  'k8s': 'Kubernetes',
  'golang': 'Go',
  'postgres': 'PostgreSQL',
  'nodejs': 'Node.js', 'node.js': 'Node.js', 'nodejs.': 'Node.js',
  'vuejs': 'Vue.js', 'vue.js': 'Vue.js',
  'nextjs': 'Next.js', 'next.js': 'Next.js',
  'llm': 'LLMs', 'llms': 'LLMs',
  'finetuning': 'Fine-tuning', 'fine-tuning': 'Fine-tuning',
  'power bi': 'Power BI',
  'github actions': 'GitHub Actions',
  'gitlab ci': 'GitLab CI',
  'ci/cd': 'CI/CD',
  'hugging face': 'Hugging Face',
  'react native': 'React Native',
  'prompt engineering': 'Prompt Engineering',
  'computer vision': 'Computer Vision',
  'scikit-learn': 'scikit-learn',
  'c++': 'C++', 'c#': 'C#', '.net': '.NET',
  'nlp': 'NLP', 'rag': 'RAG', 'sql': 'SQL', 'aws': 'AWS', 'gcp': 'GCP',
  'grpc': 'gRPC', 'dbt': 'dbt', 'mlops': 'MLOps', 'mlflow': 'MLflow',
  'pmp': 'PMP', 'pmi-acp': 'PMI-ACP', 'pgmp': 'PgMP', 'capm': 'CAPM',
  'pmbok': 'PMBOK', 'prince2': 'PRINCE2', 'cspo': 'CSPO',
  'certified scrummaster': 'Certified ScrumMaster',
  'itil': 'ITIL', 'cobit': 'COBIT', 'togaf': 'TOGAF',
  'lean six sigma': 'Lean Six Sigma', 'six sigma': 'Six Sigma',
  'cissp': 'CISSP', 'cism': 'CISM', 'cipp': 'CIPP',
  'certified scrum master': 'Certified ScrumMaster',
  'certified scrum product owner': 'CSPO',
  'pmi acp': 'PMI-ACP',
  'prince 2': 'PRINCE2',
  'lean six-sigma': 'Lean Six Sigma',
  'six-sigma': 'Six Sigma',
  'account-based marketing': 'ABM', 'account based marketing': 'ABM',
  'demand-side platform': 'DSP', 'demand side platform': 'DSP', 'dsps': 'DSP',
  'programmatic advertising': 'Programmatic',
  'programmatic display': 'Programmatic',
  'programmatic media': 'Programmatic',
  'programmatic buying': 'Programmatic',
  'media agency management': 'Media Agency Management',
  'media agencies': 'Media Agency Management',
  'media agency': 'Media Agency Management',
  'demand gen': 'Demand Generation',
  'revenue operations': 'RevOps',
  'marketing mix modeling': 'Media Mix Modeling',
};

export function canonicalize(token) {
  const key = token.toLowerCase();
  return CANONICAL[key] || DISPLAY[key] || token;
}

export function extractSkills(text) {
  if (!text)
    return new Set();
  const found = new Set();
  for (const m of text.matchAll(SKILL_PATTERN)) {
    found.add(canonicalize(m[0]));
  }
  if (GO_SKILL_PATTERN.test(text))
    found.add('Go');
  if (SAFE_CERT_PATTERN.test(text))
    found.add('SAFe');
  return found;
}
