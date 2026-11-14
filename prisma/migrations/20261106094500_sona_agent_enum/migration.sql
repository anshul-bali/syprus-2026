-- Sona is recorded as its own agent, so the admin Agent health screen can count
-- its runs and fallbacks separately from the four batch agents.
ALTER TYPE "AiAgentName" ADD VALUE IF NOT EXISTS 'ASSISTANT_CHAT';
