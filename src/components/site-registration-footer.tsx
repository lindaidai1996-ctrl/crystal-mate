import Image from 'next/image';
import footerStyles from './siteRegistrationFooter.module.css';

export function SiteRegistrationFooter() {
  const policeNumber =
    process.env.PUBLIC_SECURITY_RECORD_NUMBER?.trim() || '粤公网安备 44011202004514号';
  const policeUrl =
    process.env.PUBLIC_SECURITY_RECORD_URL?.trim() ||
    'https://beian.mps.gov.cn/#/query/webSearch?code=44011202004514';
  const policeIcon =
    process.env.PUBLIC_SECURITY_RECORD_ICON?.trim() || '/images/public-security-record.png';

  return (
    <footer className={footerStyles.footer}>
      <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
        粤ICP备2026180719号-1
      </a>
      <a href={policeUrl} target="_blank" rel="noopener noreferrer">
        <Image src={policeIcon} alt="" width={20} height={20} unoptimized />
        {policeNumber}
      </a>
    </footer>
  );
}
