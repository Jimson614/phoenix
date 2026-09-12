export type PartnerTheme = 'music' | 'art' | 'sports' | 'culture'
export type PartnerExperienceStatus = 'preview' | 'active' | 'closed'

export interface CapabilityCard {
  number: string
  title: string
  english: string
  description: string
  tags: string[]
}

export interface JourneyStep {
  number: string
  english: string
  chinese: string
  title: string
}

export interface ResponsibilityCard {
  owner: string
  role: string
  items: string[]
}

export interface OutcomeCard {
  number: string
  title: string
  items: string[]
  note: string
}

export interface PartnerExperience {
  id: string
  slug: string
  partnerName: string
  partnerRole: string
  partnerCredentials: string[]
  projectName: string
  englishName: string
  collaborationLabel: string
  subtitle: string
  theme: PartnerTheme
  heroCopy: { eyebrow: string; headline: string; description: string; supporting: string }
  tags: string[]
  capabilityCards: CapabilityCard[]
  journeySteps: JourneyStep[]
  responsibilities: ResponsibilityCard[]
  collaborationStatement: string
  outcomes: OutcomeCard[]
  cta: { headline: string; description: string; primary: string; secondary: string }
  status: PartnerExperienceStatus
}
