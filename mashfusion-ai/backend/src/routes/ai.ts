import { Router, Request, Response, NextFunction } from 'express'
import { z } from 'zod'
import axios from 'axios'
import { v4 as uuid } from 'uuid'
import { requireAuth } from '../middleware/auth'
import { validate } from '../middleware/validate'
import { AppError } from '../middleware/errorHandler'
import { supabaseAdmin } from '../config/supabase'
import { logger } from '../config/logger'
import {
  USER_SAMPLES_BUCKET,
  createSignedUrlForBucket,
  uploadUserSampleBuffer,
} from '../services/storage'

const generateSoundSchema = z.object({
  project_id: z.string().uuid(),
  prompt: z.string().min(20).max(5000),
  bpm: z.number().min(20).max(300),
  duration: z.number().positive().max(120),
  sound_type: z.string().max(50).optional(),
})

export const aiRouter = Router()
aiRouter.use(requireAuth)

// POST /api/ai/generate-sound
// Receives a structured prompt, asks the AI engine to synthesize audio,
// persists it as a user sample, and returns a signed URL + sample ref.
aiRouter.post('/generate-sound', validate(generateSoundSchema), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const reqId = (req as any).id as string | undefined
    const userId = (req as any).user.sub as string
    const { project_id, prompt, bpm, duration, sound_type } = req.body as z.infer<typeof generateSoundSchema>
    const aiUrl = `${process.env.AI_ENGINE_URL}/ai-tools/generate-sound`
    logger.info('generate-sound request received', {
      reqId, userId, projectId: project_id, bpm, duration, aiUrl,
    })

    const { data: project, error: projectErr } = await supabaseAdmin
      .from('projects')
      .select('id')
      .eq('id', project_id)
      .eq('user_id', userId)
      .maybeSingle()
    if (projectErr) throw new AppError('Database error', 500)
    if (!project) throw new AppError('Project not found', 404)

    const aiResp = await axios.post(
      aiUrl,
      { prompt, bpm, duration },
      {
        headers: { 'X-Internal-API-Key': process.env.AI_ENGINE_API_KEY },
        timeout: 120_000,
      },
    )

    const audioBase64 = String(aiResp.data?.audio_base64 ?? '')
    const remoteAudioUrl = typeof aiResp.data?.audio_url === 'string' ? aiResp.data.audio_url : null

    let audioBytes: Buffer
    if (audioBase64) {
      audioBytes = Buffer.from(audioBase64, 'base64')
    } else if (remoteAudioUrl) {
      const resolved = remoteAudioUrl.startsWith('http')
        ? remoteAudioUrl
        : `${String(process.env.AI_ENGINE_URL).replace(/\/$/, '')}${remoteAudioUrl.startsWith('/') ? '' : '/'}${remoteAudioUrl}`
      const fetched = await axios.get<ArrayBuffer>(resolved, { responseType: 'arraybuffer', timeout: 60_000 })
      audioBytes = Buffer.from(fetched.data)
    } else {
      throw new AppError('AI engine returned no audio payload', 502)
    }

    const samplePath = `${userId}/ai-generated/${Date.now()}-${uuid()}.wav`
    await uploadUserSampleBuffer(samplePath, audioBytes, 'audio/wav')

    // Build a descriptive name: "AI Kick", "AI Bass FX", "AI Pad", etc.
    const typeLabel = sound_type
      ? sound_type.charAt(0).toUpperCase() + sound_type.slice(1).replace(/_/g, ' ')
      : 'Sound'
    const name = `AI ${typeLabel}`
    const durationSec = Number(aiResp.data?.duration ?? duration)
    const { data: inserted, error: insErr } = await supabaseAdmin
      .from('user_samples')
      .insert({
        user_id: userId,
        name,
        s3_key: samplePath,
        duration_sec: durationSec,
      })
      .select('id, name, s3_key, duration_sec, created_at')
      .single()
    if (insErr || !inserted) throw new AppError('Failed to store generated sample', 500)

    const signedUrl = await createSignedUrlForBucket(USER_SAMPLES_BUCKET, samplePath, 3600)
    logger.info('generate-sound request completed', {
      reqId,
      userId,
      projectId: project_id,
      samplePath,
      durationSec,
    })
    res.status(201).json({
      data: {
        audio_url: signedUrl,
        duration: durationSec,
        sample: { ...inserted, signed_url: signedUrl },
      },
      error: null,
    })
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const reqId = (req as any).id as string | undefined
      logger.warn('generate-sound upstream call failed', {
        reqId,
        status: err.response?.status,
        message: err.message,
        data: err.response?.data,
        aiUrl: `${process.env.AI_ENGINE_URL}/ai-tools/generate-sound`,
      })
      return next(new AppError(`AI sound generation failed: ${err.message}`, 502))
    }
    next(err)
  }
})
