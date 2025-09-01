import formidable from "formidable";

export async function parseMultipartFormData(req: Request): Promise<{ fields: Record<string, any>, files: Record<string, any> }> {
    // Next.js Request -> Node.js IncomingMessage
    // @ts-ignore
    const nodeReq: any = (req as any).req || req;
    return new Promise((resolve, reject) => {
        const form = formidable({ multiples: true });
        form.parse(nodeReq, (err: Error | null, fields: Record<string, any>, files: Record<string, formidable.File>) => {
            if (err) return reject(err);
            // Felder normalisieren
            const normFields: Record<string, any> = {};
            Object.keys(fields).forEach(key => {
                normFields[key] = Array.isArray(fields[key]) ? fields[key][0] : fields[key];
            });
            // Dateien normalisieren
            const normFiles: Record<string, any> = {};
            Object.keys(files).forEach(key => {
                const file = Array.isArray(files[key]) ? files[key][0] : files[key];
                normFiles[key] = {
                    filename: file.originalFilename || file.newFilename || file.name,
                    mimetype: file.mimetype,
                    buffer: file._writeStream?.buffer || file.toBuffer?.() || file.buffer,
                    size: file.size,
                };
            });
            resolve({ fields: normFields, files: normFiles });
        });
    });
}

