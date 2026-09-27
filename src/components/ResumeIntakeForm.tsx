'use client';

/**
 * Resume upload. Required, and it submits itself: choosing the file IS the
 * action, so there is no Next button.
 *
 * The file goes straight from the browser to the uploads bucket at
 *   applicants/<uid>/resumes/<document_id>.pdf
 * through Firebase Storage, which checks the signed-in user against
 * storage.rules. That upload is what triggers the extract-resume Cloud Function,
 * so once it lands the page moves on to watch the function work.
 */
import { onAuthStateChanged } from 'firebase/auth';
import { ref, uploadBytes } from 'firebase/storage';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

import { DropZone } from '@/components/DropZone';
import { firebaseAuth, uploadsStorage } from '@/lib/firebase';

const MAX_BYTES = 10 * 1024 * 1024;

export function ResumeIntakeForm() {
  const router = useRouter();
  const [uid, setUid] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      onAuthStateChanged(firebaseAuth, (user) => {
        if (!user) router.replace('/signin');
        else setUid(user.uid);
      }),
    [router],
  );

  const upload = useCallback(
    async (file: File) => {
      if (pending || !uid) return;
      setError(null);

      if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
        setError('That file is not a PDF. Upload a PDF resume.');
        return;
      }
      if (file.size > MAX_BYTES) {
        setError('That file is over 10 MB. Export a smaller PDF and try again.');
        return;
      }

      setPending(true);
      const documentId = crypto.randomUUID();
      try {
        await uploadBytes(ref(uploadsStorage, `applicants/${uid}/resumes/${documentId}.pdf`), file, {
          contentType: 'application/pdf',
          customMetadata: { fileName: file.name },
        });
        router.push(`/applicant/intake/progress?doc=${documentId}`);
      } catch {
        setPending(false);
        setError('The upload did not go through. Check your connection and try again.');
      }
    },
    [pending, uid, router],
  );

  const invalid = error !== null;

  return (
    <form className="intake-form" aria-busy={pending} onSubmit={(event) => event.preventDefault()}>
      <DropZone
        id="resume"
        name="resume"
        accept="application/pdf,.pdf"
        label="Your resume"
        prompt="Drop your resume here."
        constraint="PDF, up to 10 MB."
        ariaLabel="Your resume, as a PDF"
        disabled={pending || !uid}
        invalid={invalid}
        describedBy={invalid ? 'resume-error' : undefined}
        onFileChosen={upload}
      />

      {/* Visually hidden; tells a screen reader what the quiet form is doing. */}
      <p className="status-sr" role="status">
        {pending ? 'Uploading your resume…' : ''}
      </p>

      {invalid ? (
        <p id="resume-error" className="outcome outcome-error" role="alert">
          {error}
        </p>
      ) : null}
    </form>
  );
}
